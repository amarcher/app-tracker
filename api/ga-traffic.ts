import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchTrafficTotals, trafficWindow, trafficNote } from './_shared/traffic.js';
import {
  GA4_PROPERTIES as PROPERTIES,
  getGa4Client as getClient,
} from './_shared/ga4.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;
    const project = (req.query.project as string) || 'animal-penpals';

    const propertyId = PROPERTIES[project];
    if (!propertyId) {
      return res.status(400).json({ error: `No GA4 property configured for project: ${project}` });
    }

    const client = getClient();
    const isRolling24h = days === 1;
    const window = trafficWindow(days, project);

    const [timeseriesResponse, topPagesResponse, sourcesResponse, totals] = await Promise.all([
      client.runReport({
        property: `properties/${propertyId}`,
        ...window,
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
        ...window,
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
        ...window,
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
      fetchTrafficTotals(client, propertyId, window),
    ]);

    const timeseries = (timeseriesResponse[0].rows || []).map((row) => ({
      date: row.dimensionValues![0].value!,
      pageviews: parseInt(row.metricValues![0].value!, 10),
      sessions: parseInt(row.metricValues![1].value!, 10),
      users: parseInt(row.metricValues![2].value!, 10),
      newUsers: parseInt(row.metricValues![3].value!, 10),
      engagementRate: parseFloat(row.metricValues![4].value!),
      avgSessionDuration: parseFloat(row.metricValues![5].value!),
      bounceRate: parseFloat(row.metricValues![6].value!),
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
      engagementRate: parseFloat(row.metricValues![2].value!),
      avgSessionDuration: parseFloat(row.metricValues![3].value!),
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ timeseries, topPages, sources, totals, note: trafficNote(days) });
  } catch (error) {
    console.error('GA4 API error:', error);
    res.status(500).json({ error: 'Failed to fetch GA4 data' });
  }
}
