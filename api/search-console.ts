import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  dateRangeForSearchConsole,
  findSiteForProject,
  listSearchConsoleSites,
  querySearchAnalytics,
} from './_shared/search-console.js';

function metric(row: { clicks?: number; impressions?: number; ctr?: number; position?: number }) {
  return {
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const project = (req.query.project as string) || '';
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;
    const { startDate, endDate } = dateRangeForSearchConsole(days);

    const sites = await listSearchConsoleSites();
    const site = findSiteForProject(project, sites);
    if (!site) {
      return res.json({
        connected: false,
        siteUrl: null,
        dateRange: { startDate, endDate },
        totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
        queries: [],
        pages: [],
        opportunities: [],
      });
    }

    const base = {
      startDate,
      endDate,
      searchType: 'web',
      dataState: 'final',
    };

    const [totalsRows, queryRows, pageRows, dateRows] = await Promise.all([
      querySearchAnalytics(site.siteUrl, { ...base, rowLimit: 1 }),
      querySearchAnalytics(site.siteUrl, {
        ...base,
        dimensions: ['query'],
        rowLimit: 20,
      }),
      querySearchAnalytics(site.siteUrl, {
        ...base,
        dimensions: ['page'],
        rowLimit: 20,
      }),
      querySearchAnalytics(site.siteUrl, {
        ...base,
        dimensions: ['date'],
        rowLimit: 100,
      }),
    ]);

    const totals = metric(totalsRows[0] ?? {});
    const queries = queryRows.map((row) => ({
      query: row.keys?.[0] ?? '',
      ...metric(row),
    }));
    const pages = pageRows.map((row) => ({
      page: row.keys?.[0] ?? '',
      ...metric(row),
    }));
    const timeseries = dateRows.map((row) => ({
      date: row.keys?.[0] ?? '',
      ...metric(row),
    }));

    const opportunities = [
      ...queries
        .filter((q) => q.impressions >= 10 && q.position >= 8 && q.position <= 20)
        .map((q) => ({
          type: 'striking-distance' as const,
          label: q.query,
          detail: `Avg position ${q.position.toFixed(1)} with ${q.impressions.toLocaleString()} impressions`,
          clicks: q.clicks,
          impressions: q.impressions,
          ctr: q.ctr,
          position: q.position,
        })),
      ...queries
        .filter((q) => q.impressions >= 25 && q.ctr < 0.02 && q.position <= 15)
        .map((q) => ({
          type: 'low-ctr' as const,
          label: q.query,
          detail: `${(q.ctr * 100).toFixed(1)}% CTR at avg position ${q.position.toFixed(1)}`,
          clicks: q.clicks,
          impressions: q.impressions,
          ctr: q.ctr,
          position: q.position,
        })),
    ].slice(0, 8);

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.json({
      connected: true,
      siteUrl: site.siteUrl,
      dateRange: { startDate, endDate },
      totals,
      queries,
      pages,
      timeseries,
      opportunities,
    });
  } catch (error) {
    console.error('Search Console API error:', error);
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;
    const { startDate, endDate } = dateRangeForSearchConsole(days);
    res.json({
      connected: false,
      setupError: error instanceof Error ? error.message : 'Failed to fetch Search Console data',
      siteUrl: null,
      dateRange: { startDate, endDate },
      totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      queries: [],
      pages: [],
      opportunities: [],
    });
  }
}
