import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

const PROPERTIES: Record<string, string> = {
  'animal-penpals': process.env.GA4_PROPERTY_ID || '',
  'space-explorer': process.env.GA4_PROPERTY_ID_SPACE_EXPLORER || '',
  'periodic-table': process.env.GA4_PROPERTY_ID_PERIODIC_TABLE || '',
  'crossword-clash': process.env.GA4_PROPERTY_ID_CROSSWORD_CLASH || '',
  'ticket-for-dinner': process.env.GA4_PROPERTY_ID_TICKET_FOR_DINNER || '',
  'superbowl-squares': process.env.GA4_PROPERTY_ID_SUPERBOWL_SQUARES || '',
  'tabbit-rabbit': process.env.GA4_PROPERTY_ID_TABBIT_RABBIT || '',
  'mark-my-words': process.env.GA4_PROPERTY_ID_MARK_MY_WORDS || '',
};

function getClient() {
  const keyJson = process.env.GA4_KEY_JSON;
  if (keyJson) {
    const credentials = JSON.parse(keyJson);
    return new BetaAnalyticsDataClient({ credentials });
  }
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
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
    const startDate = daysAgoDate(days);
    const endDate = 'today';

    const [timeseriesResponse, topPagesResponse, sourcesResponse] = await Promise.all([
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'sessions' },
          { name: 'totalUsers' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate }],
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
        dateRanges: [{ startDate, endDate }],
        dimensions: [
          { name: 'sessionSource' },
          { name: 'sessionMedium' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),
    ]);

    const timeseries = (timeseriesResponse[0].rows || []).map((row) => ({
      date: row.dimensionValues![0].value!,
      pageviews: parseInt(row.metricValues![0].value!, 10),
      sessions: parseInt(row.metricValues![1].value!, 10),
      users: parseInt(row.metricValues![2].value!, 10),
    }));

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
    }));

    const totals = timeseries.reduce(
      (acc, d) => ({
        pageviews: acc.pageviews + d.pageviews,
        sessions: acc.sessions + d.sessions,
        users: acc.users + d.users,
      }),
      { pageviews: 0, sessions: 0, users: 0 }
    );

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ timeseries, topPages, sources, totals });
  } catch (error) {
    console.error('GA4 API error:', error);
    res.status(500).json({ error: 'Failed to fetch GA4 data' });
  }
}
