import { afterEach, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: () => query }));
vi.mock('../app-store.js', () => ({ loadAppStore: async () => ({ downloads: { available: false } }) }));
vi.mock('../amazon-appstore.js', () => ({ loadAmazonAppstore: async () => ({ downloads: { available: false } }) }));
import { collectBusiness, storeSummary, validateCachedStoreSources } from '../_shared/business-data';
import { storeSource } from '../_shared/store-apps';
import type { BusinessSummary } from '../../src/types/business';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('retains recorded download totals when the selected period has no store reports', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture:fixture@localhost/fixture');
  vi.stubEnv('BUSINESS_METRICS_TOKEN', 'private-fixture-business-token-123456789');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  query.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    if (parts.join('').includes('SELECT min(date)')) {
      expect(parts.join('')).toContain('source IS NULL');
      const [project, store, source, acceptLegacy] = values;
      expect(source).toBe(storeSource(String(project), store as 'apple' | 'amazon'));
      if (store === 'google' || project === 'fable-designer' && store === 'amazon') {
        expect(acceptLegacy).toBe(false);
        return [{ since: null, downloads: null }];
      }
      expect(acceptLegacy).toBe(true);
      return [{ since: '2026-08-01', downloads: 12 }];
    }
    throw new Error('A missing report must not write synthetic download rows');
  });

  const report = await collectBusiness(7, true);
  expect(query).toHaveBeenCalledTimes(6);
  for (const app of report.apps) for (const store of app.stores) {
    expect(store.downloads).toBeNull();
    expect(store.timeseries).toEqual([]);
    const misattributed = store.store === 'google' || app.project === 'fable-designer' && store.store === 'amazon';
    expect(store.recordedSince).toBe(misattributed ? null : '2026-08-01');
    expect(store.recordedDownloads).toBe(misattributed ? null : 12);
  }
});

it('quarantines misattributed Fable/Amazon snapshots without losing verified history', () => {
  const legacy = { ...storeSummary('amazon', [{ date: '2026-08-01', downloads: 0 }], ['2026-08-01']), recordedSince: '2026-08-01', recordedDownloads: 0 };
  const report: BusinessSummary = { version: 1, generatedAt: '2026-09-12T00:00:00Z', range: { from: '2026-08-01', through: '2026-08-01', timezone: 'UTC' }, fable: null,
    apps: [{ project: 'space-race', name: 'Space Race', stores: [legacy] }, { project: 'fable-designer', name: 'Fable Reader', stores: [legacy, { ...legacy, store: 'apple', downloads: 4 }] }] };
  const corrected = validateCachedStoreSources(report);
  expect(corrected.apps[0].stores[0]).toEqual(legacy);
  expect(corrected.apps[1].stores[0]).toMatchObject({ available: false, downloads: null, timeseries: [], latest: null, recordedSince: null, recordedDownloads: null });
  expect(corrected.apps[1].stores[1].downloads).toBe(4);
  expect(report.apps[1].stores[0]).toEqual(legacy);

  const sourced = { ...legacy, source: storeSource('fable-designer', 'amazon'), downloads: 6 };
  report.apps[1].stores[0] = sourced;
  expect(validateCachedStoreSources(report).apps[1].stores[0]).toEqual(sourced);
});
