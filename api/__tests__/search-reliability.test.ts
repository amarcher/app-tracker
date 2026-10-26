import { expect, it } from 'vitest';
import { findSiteForProject } from '../_shared/search-console';
it('finds Fable alongside the other dashboard projects', () => {
  expect(findSiteForProject('fable-designer', [{ siteUrl: 'sc-domain:fabledesigner.com' }])).toEqual({ siteUrl: 'sc-domain:fabledesigner.com' });
});
it('prefers the project URL property over a broader parent domain', () => {
  expect(findSiteForProject('space-race', [{ siteUrl: 'sc-domain:spaceexplorer.tech' }, { siteUrl: 'https://game.spaceexplorer.tech/' }])).toEqual({ siteUrl: 'https://game.spaceexplorer.tech/' });
});

import { afterEach, vi } from 'vitest';
vi.mock('google-auth-library', () => ({ GoogleAuth: class { async getAccessToken() { return 'test-token'; } } }));
import { queryProjectSearchAnalytics, PROJECT_DOMAINS } from '../_shared/search-console';
import { GA4_PROPERTIES } from '../_shared/ga4';
import { PROJECTS } from '../../src/config/projects';
import detail from '../search-console';
import survey from '../search-console-sites';

afterEach(() => vi.unstubAllGlobals());
const pages = [
  ['https://spaceexplorer.tech/', 10],
  ['https://game.spaceexplorer.tech/', 3],
  ['https://www.game.spaceexplorer.tech/play', 2],
  ['https://gameXspaceexplorer.tech/', 100],
  ['https://game.spaceexplorer.tech.evil.test/', 100],
] as const;
function mockSearch() {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.body) return { ok: true, json: async () => ({ siteEntry: [{ siteUrl: 'sc-domain:spaceexplorer.tech' }] }) };
    const body = JSON.parse(String(init.body));
    const expression = body.dimensionFilterGroups?.[0]?.filters?.[0]?.expression;
    const impressions = pages.filter(([url]) => !expression || new RegExp(expression).test(url)).reduce((sum, [, count]) => sum + count, 0);
    return { ok: true, json: async () => ({ rows: [{ impressions, clicks: 1 }] }) };
  }));
}
it('scopes a parent domain to the exact project hostname and www alias', async () => {
  mockSearch();
  expect(await queryProjectSearchAnalytics('space-race', 'sc-domain:spaceexplorer.tech', {})).toEqual([{ impressions: 5, clicks: 1 }]);
  expect(await queryProjectSearchAnalytics('space-explorer', 'sc-domain:spaceexplorer.tech', {})).toEqual([{ impressions: 10, clicks: 1 }]);
});
it('applies the hostname restriction to detail and survey routes', async () => {
  mockSearch();
  const response = () => ({ json: vi.fn(), setHeader: vi.fn() });
  const d = response();
  await detail({ query: { project: 'space-race' } } as never, d as never);
  expect(d.json.mock.calls[0][0]).toMatchObject({ connected: true, totals: { impressions: 5 }, queries: [{ impressions: 5 }], pages: [{ impressions: 5 }], timeseries: [{ impressions: 5 }] });
  const s = response();
  await survey({ query: {} } as never, s as never);
  expect(s.json.mock.calls[0][0].projects.find((p: { project: string }) => p.project === 'space-race')).toMatchObject({ impressions: 5, status: 'active' });
  expect(s.json.mock.calls[0][0].projects.find((p: { project: string }) => p.project === 'fable-designer')).toMatchObject({ status: 'missing-property' });
});
it('keeps all dashboard projects represented in both coverage maps', () => {
  const slugs = PROJECTS.map(p => p.value).sort();
  expect(Object.keys(PROJECT_DOMAINS).sort()).toEqual(slugs);
  expect(Object.keys(GA4_PROPERTIES).sort()).toEqual(slugs);
});
