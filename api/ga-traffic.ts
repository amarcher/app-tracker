import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { parseDateHour, tzForProject } from './_shared/timezone.js';

const env = (name: string) => (process.env[name] ?? '').trim();

const PROPERTIES: Record<string, string> = {
  'animal-penpals': env('GA4_PROPERTY_ID'),
  'space-explorer': env('GA4_PROPERTY_ID_SPACE_EXPLORER'),
  'periodic-table': env('GA4_PROPERTY_ID_PERIODIC_TABLE'),
  'crossword-clash': env('GA4_PROPERTY_ID_CROSSWORD_CLASH'),
  'ticket-for-dinner': env('GA4_PROPERTY_ID_TICKET_FOR_DINNER'),
  'superbowl-squares': env('GA4_PROPERTY_ID_SUPERBOWL_SQUARES'),
  'tabbit-rabbit': env('GA4_PROPERTY_ID_TABBIT_RABBIT'),
  'mark-my-words': env('GA4_PROPERTY_ID_MARK_MY_WORDS'),
};

function getClient() {
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

function daysAgoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;
    const project = (req.query.project as string) || 'animal-penpals';

    const propertyId = PROPERTIES[project] || PROPERTIES['animal-penpals'];
    if (!propertyId) {
      return res.status(400).json({ error: `No GA4 property configured for project: ${project}` });
    }

    const client = getClient();
    // For days=1: rolling 24h using `dateHour` dimension (fetch 3 calendar days
    // to cover the last 48h window in any timezone).
    // For days>1: last N calendar days inclusive of today, matching
    // api/traffic-overview.ts.
    const isRolling24h = days === 1;
    const tz = tzForProject(project);
    // Timeseries query needs 3 calendar days of hourly data to cover the
    // rolling 48h window in any tz. topPages/sources can use a tighter range.
    const startDate = isRolling24h ? daysAgoDate(2) : daysAgoDate(days - 1);
    const endDate = 'today';
    const listStartDate = isRolling24h ? daysAgoDate(1) : startDate;

    const [timeseriesResponse, topPagesResponse, sourcesResponse] = await Promise.all([
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: isRolling24h ? 'dateHour' : 'date' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'engagementRate' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
        ],
        orderBys: [{ dimension: { dimensionName: isRolling24h ? 'dateHour' : 'date' } }],
        limit: isRolling24h ? 500 : 1000,
      }),
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: listStartDate, endDate }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'sessions' },
        ],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      }),
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: listStartDate, endDate }],
        dimensions: [
          { name: 'sessionSource' },
          { name: 'sessionMedium' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'engagementRate' },
          { name: 'averageSessionDuration' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),
    ]);

    const allPoints = (timeseriesResponse[0].rows || []).map((row) => ({
      date: row.dimensionValues![0].value!,
      pageviews: parseInt(row.metricValues![0].value!, 10),
      sessions: parseInt(row.metricValues![1].value!, 10),
      users: parseInt(row.metricValues![2].value!, 10),
      newUsers: parseInt(row.metricValues![3].value!, 10),
      engagementRate: parseFloat(row.metricValues![4].value!),
      avgSessionDuration: parseFloat(row.metricValues![5].value!),
      bounceRate: parseFloat(row.metricValues![6].value!),
    }));

    // For rolling 24h: keep only hours within the last 24h wall-clock window.
    const timeseries = isRolling24h
      ? allPoints.filter((p) => {
          const ageMs = Date.now() - parseDateHour(p.date, tz);
          return ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000;
        })
      : allPoints;

    const topPages = (topPagesResponse[0].rows || []).map((row) => ({
      path: row.dimensionValues![0].value!,
      pageviews: parseInt(row.metricValues![0].value!, 10),
      sessions: parseInt(row.metricValues![1].value!, 10),
    }));

    const sources = (sourcesResponse[0].rows || []).map((row) => ({
      source: row.dimensionValues![0].value!,
      medium: row.dimensionValues![1].value!,
      sessions: parseInt(row.metricValues![0].value!, 10),
      users: parseInt(row.metricValues![1].value!, 10),
      engagementRate: parseFloat(row.metricValues![2].value!),
      avgSessionDuration: parseFloat(row.metricValues![3].value!),
    }));

    const totalSessions = timeseries.reduce((s, d) => s + d.sessions, 0);
    const totals = {
      pageviews: timeseries.reduce((s, d) => s + d.pageviews, 0),
      sessions: totalSessions,
      users: timeseries.reduce((s, d) => s + d.users, 0),
      newUsers: timeseries.reduce((s, d) => s + d.newUsers, 0),
      engagementRate: totalSessions > 0
        ? timeseries.reduce((s, d) => s + d.engagementRate * d.sessions, 0) / totalSessions
        : 0,
      avgSessionDuration: totalSessions > 0
        ? timeseries.reduce((s, d) => s + d.avgSessionDuration * d.sessions, 0) / totalSessions
        : 0,
      bounceRate: totalSessions > 0
        ? timeseries.reduce((s, d) => s + d.bounceRate * d.sessions, 0) / totalSessions
        : 0,
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ timeseries, topPages, sources, totals });
  } catch (error) {
    console.error('GA4 API error:', error);
    res.status(500).json({ error: 'Failed to fetch GA4 data' });
  }
}
