import { afterEach, expect, it, vi } from 'vitest';

const { loadGooglePlay } = vi.hoisted(() => ({ loadGooglePlay: vi.fn() }));
vi.mock('../_shared/google-play.js', () => ({ loadGooglePlay }));
import handler, { loadGooglePlayPanel, summarizeInstalls } from '../google-play';
import type { StoreDay } from '../../src/types/business';

afterEach(() => vi.clearAllMocks());

const days: StoreDay[] = [
  { date: '2026-09-11', downloads: 4, deviceInstalls: 4, activeDeviceInstalls: 4, updates: 0, reportAvailable: true },
  { date: '2026-09-12', downloads: 2, deviceInstalls: 2, activeDeviceInstalls: 5, updates: 1, reportAvailable: true },
];

it('sums the reported days and takes the latest day as the active-devices gauge', () => {
  expect(summarizeInstalls(days)).toEqual({ userInstalls: 6, deviceInstalls: 6, latestDate: '2026-09-12', latestActiveDeviceInstalls: 5 });
  expect(summarizeInstalls([{ ...days[0], deviceInstalls: null }, days[1]])?.deviceInstalls).toBeNull();
  expect(summarizeInstalls([])).toBeNull();
});

it('serves Space Race through the shared collector with a validated range', async () => {
  loadGooglePlay.mockResolvedValue({ downloads: { available: true, timeseries: days } });
  const panel = await loadGooglePlayPanel('space-race', '7d');
  expect(loadGooglePlay).toHaveBeenCalledWith('space-race', '7d');
  expect(panel).toEqual({
    connected: true,
    app: { name: 'Space Race: 1000 Light-Years', packageName: 'tech.spaceexplorer.spacerace' },
    installs: { available: true, timeseries: days, totals: { userInstalls: 6, deviceInstalls: 6, latestDate: '2026-09-12', latestActiveDeviceInstalls: 5 } },
  });
  await loadGooglePlayPanel('space-race', '14d');
  expect(loadGooglePlay).toHaveBeenLastCalledWith('space-race', '30d');
});

it('passes the collector reason through and refuses projects without a Play app', async () => {
  loadGooglePlay.mockResolvedValue({ downloads: { available: false, timeseries: [] }, connectionReason: 'Google Play reporting access is awaiting connection.' });
  const panel = await loadGooglePlayPanel('space-race', '7d');
  expect(panel.installs).toEqual({ available: false, reason: 'Google Play reporting access is awaiting connection.' });
  expect(await loadGooglePlayPanel('animal-penpals', '7d')).toMatchObject({ connected: false, app: null });
  expect(loadGooglePlay).toHaveBeenCalledTimes(1);
});

it('responds with the Amazon route cache policy', async () => {
  loadGooglePlay.mockResolvedValue({ downloads: { available: true, timeseries: days } });
  const res = { setHeader: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnThis() };
  await handler({ query: { project: 'space-race', range: '7d' } } as any, res as any);
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
  expect(res.json.mock.calls[0][0].installs.totals.userInstalls).toBe(6);
});
