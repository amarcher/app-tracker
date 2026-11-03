/**
 * Who is not a real visitor — one list for every app and every source.
 *
 * At this volume the owner's own testing and a few robots outweigh real
 * people, so every per-visitor query (GA4 traffic, PostHog events) leaves
 * these out. Measured over Oct 3–Nov 1 2026 (docs: README "Real traffic only").
 *
 * GA4 never exposes IPs, so there the owner is matched by GA4's city and
 * robots by place or by a headless-browser fingerprint. PostHog keeps the
 * raw IP, and its GeoIP database disagrees with GA4's (it puts the owner's
 * home IP in Braintree, MA), so there the owner is matched by IP.
 *
 * Store reports (App Store, Google Play, Amazon), Cloudflare and the
 * api_usage cost ledger are aggregates with no per-visitor field, so nothing
 * can be removed from them at query time.
 */

export interface Place {
  city: string;
  /** GA4 `region` / PostHog `$geoip_subdivision_1_name`. A city name alone is
   * not enough: Lexington, Kentucky is a city of 320,000. */
  region: string;
}

/** The owner's home connections (72.74.126.56 since Apr 2026, 70.22.234.144 before). */
export const OWNER_IPS = ['72.74.126.56', '70.22.234.144'];

/** Where GA4 places the owner's home connection. */
export const OWNER_PLACES: Place[] = [{ city: 'Lexington', region: 'Massachusetts' }];

/**
 * Small towns that host cloud data centres. Every visit from them in the
 * measured month was a one-page, few-second robot visit. Big cities that also
 * host cloud regions (Phoenix, San Jose, Chicago, San Antonio, Des Moines)
 * stay in: real people visit from them, and their robots match
 * HEADLESS_SCREENS instead.
 */
export const DATA_CENTRE_PLACES: Place[] = [
  { city: 'Ashburn', region: 'Virginia' },
  { city: 'Boardman', region: 'Oregon' },
  { city: 'Boydton', region: 'Virginia' },
  { city: 'Cheyenne', region: 'Wyoming' },
  { city: 'Council Bluffs', region: 'Iowa' },
  { city: 'Flint Hill', region: 'Virginia' },
  { city: 'Forest City', region: 'North Carolina' },
  { city: 'Manassas', region: 'Virginia' },
  { city: 'Moses Lake', region: 'Washington' },
  { city: 'Prineville', region: 'Oregon' },
  { city: 'Quincy', region: 'Washington' },
  { city: 'Reston', region: 'Virginia' },
  { city: 'The Dalles', region: 'Oregon' },
];

/**
 * Headless-browser default screens (Puppeteer/Playwright). Counted as robots
 * only on a Direct session: people on 150%-scaled 1080p laptops also report
 * 1280x720, and they arrive from search.
 */
export const HEADLESS_SCREENS = ['800x600', '1280x720'];

/** Screens no phone, tablet or monitor has — robots on any channel. */
export const ROBOT_SCREENS = ['1024x1024', '1280x1200', '1280x1280', '1366x1366', '1600x1600', '2000x2000'];

// ── GA4 ───────────────────────────────────────────────────────────────────

/** Structural subset of the GA4 Data API `FilterExpression`. */
export type Ga4FilterExpression =
  | { filter: { fieldName: string; stringFilter?: { value: string; matchType: 'EXACT' }; inListFilter?: { values: string[] } } }
  | { andGroup: { expressions: Ga4FilterExpression[] } }
  | { orGroup: { expressions: Ga4FilterExpression[] } }
  | { notExpression: Ga4FilterExpression };

const exact = (fieldName: string, value: string): Ga4FilterExpression => ({
  filter: { fieldName, stringFilter: { value, matchType: 'EXACT' } },
});

const placeMatch = ({ city, region }: Place): Ga4FilterExpression => ({
  andGroup: { expressions: [exact('city', city), exact('region', region)] },
});

/**
 * `dimensionFilter` for every GA4 report: keeps everything except the
 * owner's city, data-centre towns, headless Direct sessions and robot-only
 * screens. The filter
 * works whether or not the report asks for these dimensions.
 */
export function ga4RealTrafficFilter(): Ga4FilterExpression {
  return {
    notExpression: {
      orGroup: {
        expressions: [
          ...[...OWNER_PLACES, ...DATA_CENTRE_PLACES].map(placeMatch),
          {
            andGroup: {
              expressions: [
                exact('sessionDefaultChannelGroup', 'Direct'),
                { filter: { fieldName: 'screenResolution', inListFilter: { values: HEADLESS_SCREENS } } },
              ],
            },
          },
          { filter: { fieldName: 'screenResolution', inListFilter: { values: ROBOT_SCREENS } } },
        ],
      },
    },
  };
}

// ── PostHog ───────────────────────────────────────────────────────────────

const sqlString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Adds the real-traffic filter to a report window. A window may carry its own
 * `dimensionFilter` (the 24 h view lists hour buckets), so the two are ANDed
 * rather than one replacing the other.
 */
export function withRealTraffic<W extends { dimensionFilter?: Ga4FilterExpression }>(window: W): W & { dimensionFilter: Ga4FilterExpression } {
  const real = ga4RealTrafficFilter();
  return {
    ...window,
    dimensionFilter: window.dimensionFilter ? { andGroup: { expressions: [window.dimensionFilter, real] } } : real,
  };
}

/**
 * A HogQL property filter for a PostHog `TrendsQuery`'s `properties`: drops
 * the owner's IPs and data-centre towns. No screen rule here — PostHog has no
 * channel to tell a robot's Direct visit from a Bing user on a 1280x720
 * laptop, and robots rarely fire the custom events the dashboard counts.
 */
export function posthogRealTrafficFilter() {
  const ips = OWNER_IPS.map(sqlString).join(', ');
  const places = DATA_CENTRE_PLACES.map((p) => `(${sqlString(p.city)}, ${sqlString(p.region)})`).join(', ');
  // ifNull: an event with no IP or no GeoIP must be kept, and `not(NULL)` is
  // NULL, which a filter treats as false.
  return {
    type: 'hogql' as const,
    key:
      `not(ifNull(properties.$ip, '') in (${ips})) and ` +
      `not((ifNull(properties.$geoip_city_name, ''), ifNull(properties.$geoip_subdivision_1_name, '')) in (${places}))`,
  };
}
