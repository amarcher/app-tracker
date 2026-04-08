import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN?.trim();
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();

const ZONES: Record<string, { zoneId: string; cdnHost: string }> = {
  'animal-penpals': {
    zoneId: (process.env.CLOUDFLARE_ZONE_ID_ANIMAL_PENPALS ?? '').trim(),
    cdnHost: 'videos.animalpenpals.tech',
  },
  'periodic-table': {
    zoneId: (process.env.CLOUDFLARE_ZONE_ID_PERIODIC_TABLE ?? '').trim(),
    cdnHost: 'videos.periodictable.tech',
  },
  'space-explorer': {
    zoneId: (process.env.CLOUDFLARE_ZONE_ID_SPACE_EXPLORER ?? '').trim(),
    cdnHost: 'assets.spaceexplorer.tech',
  },
};

const R2_BUCKETS: Record<string, string> = {
  'periodic-table': 'periodic-table-elements',
  'animal-penpals': 'animal-penpals-videos',
  'space-explorer': 'solar-system-textures',
};

function daysAgoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

// Cloudflare considers these cache statuses as "cache hits" for billing /
// analytics purposes. Everything else (miss, expired, dynamic, bypass, none,
// unknown, ignored) counts as uncached.
const CACHED_STATUSES = new Set([
  'hit',
  'stream_hit',
  'revalidated',
  'updating',
  'stale',
]);

async function queryGraphQL(query: string, variables: Record<string, unknown>) {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cloudflare GraphQL error ${res.status}: ${text}`);
  }
  const body = await res.json();
  // Cloudflare returns HTTP 200 even for GraphQL errors — surface them
  // explicitly so they don't get silently swallowed as empty results.
  if (body?.errors?.length) {
    console.error('Cloudflare GraphQL errors:', JSON.stringify(body.errors));
  }
  return body;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;
    const project = (req.query.project as string) || '';

    const zone = ZONES[project];
    if (zone) {
      zone.zoneId = zone.zoneId.trim();
    }
    if (!zone || !zone.zoneId) {
      // Return empty data instead of 400 to avoid console errors
      return res.json({
        timeseries: [],
        totals: { bandwidth: 0, cachedBandwidth: 0, requests: 0, cachedRequests: 0, cacheHitRatio: 0 },
        r2: null,
      });
    }

    const isRolling24h = days === 1;
    const since = daysAgoDate(days);
    const until = daysAgoDate(0);

    // For days>1: daily rollups via httpRequests1dGroups (legacy, day-level).
    // For days=1: hourly rollups via httpRequestsAdaptiveGroups, grouped by
    //   cacheStatus so we can compute cached bytes/requests client-side.
    const nowIso = new Date().toISOString();
    const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Note: httpRequestsAdaptiveGroups uses `count` (group level) for request
    // count, not `sum.requests`. Byte field is `sum.edgeResponseBytes`.
    const httpQuery = isRolling24h
      ? `{
          viewer {
            zones(filter: { zoneTag: "${zone.zoneId}" }) {
              httpRequestsAdaptiveGroups(
                filter: { datetime_geq: "${since24hIso}", datetime_leq: "${nowIso}" }
                orderBy: [datetimeHour_ASC]
                limit: 1000
              ) {
                count
                dimensions { datetimeHour cacheStatus }
                sum { edgeResponseBytes }
              }
            }
          }
        }`
      : `{
          viewer {
            zones(filter: { zoneTag: "${zone.zoneId}" }) {
              httpRequests1dGroups(
                filter: { date_geq: "${since}", date_leq: "${until}" }
                orderBy: [date_ASC]
                limit: 1000
              ) {
                dimensions { date }
                sum {
                  bytes
                  requests
                  cachedBytes
                  cachedRequests
                }
              }
            }
          }
        }`;

    const bucketName = R2_BUCKETS[project];
    const yesterday = daysAgoDate(1);

    const r2Query = `{
      viewer {
        accounts(filter: { accountTag: "${CLOUDFLARE_ACCOUNT_ID}" }) {
          r2StorageAdaptiveGroups(
            filter: { date: "${yesterday}", bucketName: "${bucketName}" }
            limit: 1
          ) {
            max {
              objectCount
              payloadSize
              metadataSize
            }
          }
        }
      }
    }`;

    const [httpResult, r2Result] = await Promise.all([
      queryGraphQL(httpQuery, {}),
      bucketName && CLOUDFLARE_ACCOUNT_ID
        ? queryGraphQL(r2Query, {}).catch(() => null)
        : Promise.resolve(null),
    ]);

    let timeseries: {
      date: string;
      bytes: number;
      cachedBytes: number;
      requests: number;
      cachedRequests: number;
    }[];

    if (isRolling24h) {
      // Adaptive groups returns one row per (hour, cacheStatus).
      // Collapse to one entry per hour, splitting cached vs uncached.
      const adaptiveGroups = httpResult?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [];
      const byHour = new Map<string, {
        date: string;
        bytes: number;
        cachedBytes: number;
        requests: number;
        cachedRequests: number;
      }>();
      for (const g of adaptiveGroups) {
        // datetimeHour looks like "2026-04-08T12:00:00Z"
        const dh: string = g.dimensions.datetimeHour;
        const dateKey = `${dh.slice(0, 4)}${dh.slice(5, 7)}${dh.slice(8, 10)}${dh.slice(11, 13)}`;
        let entry = byHour.get(dateKey);
        if (!entry) {
          entry = { date: dateKey, bytes: 0, cachedBytes: 0, requests: 0, cachedRequests: 0 };
          byHour.set(dateKey, entry);
        }
        const bytes = Number(g.sum?.edgeResponseBytes) || 0;
        const requests = Number(g.count) || 0;
        entry.bytes += bytes;
        entry.requests += requests;
        if (CACHED_STATUSES.has(g.dimensions.cacheStatus)) {
          entry.cachedBytes += bytes;
          entry.cachedRequests += requests;
        }
      }
      timeseries = Array.from(byHour.values()).sort((a, b) => a.date.localeCompare(b.date));
    } else {
      const httpGroups = httpResult?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
      timeseries = httpGroups.map((g: any) => ({
        date: g.dimensions.date.replace(/-/g, ''),
        bytes: g.sum.bytes,
        cachedBytes: g.sum.cachedBytes,
        requests: g.sum.requests,
        cachedRequests: g.sum.cachedRequests,
      }));
    }

    const totals = timeseries.reduce(
      (acc: any, d: any) => ({
        bandwidth: acc.bandwidth + d.bytes,
        cachedBandwidth: acc.cachedBandwidth + d.cachedBytes,
        requests: acc.requests + d.requests,
        cachedRequests: acc.cachedRequests + d.cachedRequests,
      }),
      { bandwidth: 0, cachedBandwidth: 0, requests: 0, cachedRequests: 0 }
    );
    totals.cacheHitRatio = totals.requests > 0
      ? (totals.cachedRequests / totals.requests) * 100
      : 0;

    let r2 = null;
    const r2Groups = r2Result?.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups;
    if (r2Groups && r2Groups.length > 0) {
      r2 = {
        objectCount: r2Groups[0].max.objectCount,
        storageSizeBytes: r2Groups[0].max.payloadSize + (r2Groups[0].max.metadataSize || 0),
        bucketName: bucketName,
      };
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ timeseries, totals, r2 });
  } catch (error) {
    console.error('Cloudflare CDN API error:', error);
    res.status(500).json({ error: 'Failed to fetch Cloudflare CDN data' });
  }
}
