import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  PROJECT_DOMAINS,
  dateRangeForSearchConsole,
  findSiteForProject,
  listSearchConsoleSites,
  querySearchAnalytics,
} from './_shared/search-console.js';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const { startDate, endDate } = dateRangeForSearchConsole(30);
  try {
    const sites = await listSearchConsoleSites();

    const projects = await Promise.all(
      Object.entries(PROJECT_DOMAINS).map(async ([project, domain]) => {
        const site = findSiteForProject(project, sites);
        if (!site) {
          return {
            project,
            domain,
            status: 'missing-property',
            siteUrl: null,
            clicks: 0,
            impressions: 0,
          };
        }

        try {
          const rows = await querySearchAnalytics(site.siteUrl, {
            startDate,
            endDate,
            searchType: 'web',
            dataState: 'final',
            rowLimit: 1,
          });
          const totals = rows[0] ?? {};
          return {
            project,
            domain,
            status: (totals.impressions ?? 0) > 0 ? 'active' : 'connected-no-data',
            siteUrl: site.siteUrl,
            permissionLevel: site.permissionLevel,
            clicks: totals.clicks ?? 0,
            impressions: totals.impressions ?? 0,
          };
        } catch (error) {
          return {
            project,
            domain,
            status: 'query-error',
            siteUrl: site.siteUrl,
            clicks: 0,
            impressions: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }),
    );

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.json({
      dateRange: { startDate, endDate },
      sites,
      projects,
    });
  } catch (error) {
    console.error('Search Console site survey error:', error);
    const setupError = error instanceof Error ? error.message : 'Failed to survey Search Console sites';
    res.json({
      setupError,
      dateRange: { startDate, endDate },
      sites: [],
      projects: Object.entries(PROJECT_DOMAINS).map(([project, domain]) => ({
        project,
        domain,
        status: 'query-error',
        siteUrl: null,
        clicks: 0,
        impressions: 0,
        error: setupError,
      })),
    });
  }
}
