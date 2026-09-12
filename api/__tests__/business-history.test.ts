import { afterEach, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: () => query }));
vi.mock('../app-store.js', () => ({ loadAppStore: async () => ({ downloads: { available: false } }) }));
vi.mock('../amazon-appstore.js', () => ({ loadAmazonAppstore: async () => ({ downloads: { available: false } }) }));
import { collectBusiness } from '../_shared/business-data';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('retains recorded download totals when the selected period has no store reports', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture:fixture@localhost/fixture');
  vi.stubEnv('BUSINESS_METRICS_TOKEN', 'private-fixture-business-token-123456789');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  query.mockImplementation(async (parts: TemplateStringsArray) => {
    if (parts.join('').includes('SELECT min(date)')) return [{ since: '2026-08-01', downloads: 12 }];
    throw new Error('A missing report must not write synthetic download rows');
  });

  const report = await collectBusiness(7, true);
  expect(query).toHaveBeenCalledTimes(4);
  for (const app of report.apps) for (const store of app.stores) {
    expect(store.downloads).toBeNull();
    expect(store.timeseries).toEqual([]);
    expect(store.recordedSince).toBe('2026-08-01');
    expect(store.recordedDownloads).toBe(12);
  }
});
