import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CdnResponse } from '../../src/types';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('CLOUDFLARE_ZONE_ID_SPACE_EXPLORER', 'test-zone');
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token');
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function getCdn(range: string, zoneData: unknown): Promise<CdnResponse> {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { viewer: { zones: [zoneData] } } }),
  })));
  const { default: handler } = await import('../cloudflare-cdn');
  const res = { json: vi.fn<(body: CdnResponse) => void>(), setHeader: vi.fn(), status: vi.fn().mockReturnThis() };
  await handler({ query: { project: 'space-explorer', range } } as never, res as never);
  return res.json.mock.calls[0][0];
}

it('returns complete daily totals with a request-weighted cache hit percentage', async () => {
  const result = await getCdn('7d', { httpRequests1dGroups: [
    { dimensions: { date: '2026-10-24' }, sum: { bytes: 1000, cachedBytes: 500, requests: 2, cachedRequests: 1 } },
    { dimensions: { date: '2026-10-25' }, sum: { bytes: 9000, cachedBytes: 8000, requests: 8, cachedRequests: 8 } },
  ] });
  expect(result.totals).toEqual({ bandwidth: 10000, cachedBandwidth: 8500, requests: 10, cachedRequests: 9, cacheHitRatio: 90 });
  expect(result.timeseries.map(day => day.date)).toEqual(['20261024', '20261025']);
  expect(result.r2).toBeNull();
});

it('aggregates hourly cache statuses before calculating the percentage', async () => {
  const result = await getCdn('1d', { httpRequestsAdaptiveGroups: [
    { dimensions: { datetimeHour: '2026-10-25T12:00:00Z', cacheStatus: 'hit' }, count: 3, sum: { edgeResponseBytes: 300 } },
    { dimensions: { datetimeHour: '2026-10-25T12:00:00Z', cacheStatus: 'miss' }, count: 1, sum: { edgeResponseBytes: 200 } },
    { dimensions: { datetimeHour: '2026-10-25T13:00:00Z', cacheStatus: 'revalidated' }, count: 1, sum: { edgeResponseBytes: 100 } },
  ] });
  expect(result.totals).toEqual({ bandwidth: 600, cachedBandwidth: 400, requests: 5, cachedRequests: 4, cacheHitRatio: 80 });
  expect(result.timeseries).toEqual([
    { date: '2026102512', bytes: 500, cachedBytes: 300, requests: 4, cachedRequests: 3 },
    { date: '2026102513', bytes: 100, cachedBytes: 100, requests: 1, cachedRequests: 1 },
  ]);
});

it('returns a finite zero cache hit percentage when there are no requests', async () => {
  const result = await getCdn('7d', { httpRequests1dGroups: [] });
  expect(result.totals).toEqual({ bandwidth: 0, cachedBandwidth: 0, requests: 0, cachedRequests: 0, cacheHitRatio: 0 });
});
