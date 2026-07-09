import { BetaAnalyticsDataClient } from '@google-analytics/data';

const env = (name: string) => (process.env[name] ?? '').trim();

/**
 * GA4 numeric property ids keyed by dashboard project slug.
 *
 * Single source of truth — both the per-project traffic route
 * (`ga-traffic.ts`) and the Home overview (`traffic-overview.ts`) read this.
 * Add a new project here ONCE. An empty string means the property env var
 * isn't set; callers filter those out (`filter(([, id]) => !!id)`).
 */
export const GA4_PROPERTIES: Record<string, string> = {
  'animal-penpals': env('GA4_PROPERTY_ID'),
  'space-explorer': env('GA4_PROPERTY_ID_SPACE_EXPLORER'),
  'space-race': env('GA4_PROPERTY_ID_SPACE_RACE'),
  'periodic-table': env('GA4_PROPERTY_ID_PERIODIC_TABLE'),
  'crossword-clash': env('GA4_PROPERTY_ID_CROSSWORD_CLASH'),
  'ticket-for-dinner': env('GA4_PROPERTY_ID_TICKET_FOR_DINNER'),
  'superbowl-squares': env('GA4_PROPERTY_ID_SUPERBOWL_SQUARES'),
  'tabbit-rabbit': env('GA4_PROPERTY_ID_TABBIT_RABBIT'),
  'mark-my-words': env('GA4_PROPERTY_ID_MARK_MY_WORDS'),
  'mtg-dash': env('GA4_PROPERTY_ID_MTG_DASH'),
  'recipe-guide': env('GA4_PROPERTY_ID_RECIPE_GUIDE'),
  'fable-designer': env('GA4_PROPERTY_ID_FABLE_DESIGNER'),
};

/**
 * A GA4 Data API client, credentialed from GA4_KEY_JSON, a key file
 * (GOOGLE_APPLICATION_CREDENTIALS), or Application Default Credentials.
 */
export function getGa4Client(): BetaAnalyticsDataClient {
  const keyJson = env('GA4_KEY_JSON');
  if (keyJson) {
    const credentials = JSON.parse(keyJson);
    return new BetaAnalyticsDataClient({ credentials });
  }
  const keyFile = env('GOOGLE_APPLICATION_CREDENTIALS');
  if (keyFile) {
    return new BetaAnalyticsDataClient({ keyFilename: keyFile });
  }
  return new BetaAnalyticsDataClient();
}

/** `YYYY-MM-DD` for `days` ago (UTC), for GA4 `dateRanges`. */
export function daysAgoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}
