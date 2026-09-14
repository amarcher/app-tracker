import { afterEach, expect, it, vi } from 'vitest';
const { token } = vi.hoisted(() => ({ token: vi.fn().mockResolvedValue('fixture-token') }));
vi.mock('google-auth-library', () => ({ GoogleAuth: class { getAccessToken = token; } }));
import { decodeGooglePlayCsv, googlePlayCredentials, loadGooglePlay, parseGooglePlayInstalls } from '../_shared/google-play';
import { storeSummary } from '../_shared/business-data';

const pkg = 'com.fabledesigner.reader';
const header = 'Date,Package Name,Country,Daily User Installs,Daily Device Installs,Installs on active devices,Daily Device Upgrades';
const csv = `${header}\n2026-09-09,${pkg},US,2,3,5,1\n2026-09-09,${pkg},GB,1,1,2,0\n2026-09-10,${pkg},US,0,0,8,2`;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('decodes Google UTF-16 reports and adds one country dimension per date', () => {
  const text = decodeGooglePlayCsv(Buffer.from('\uFEFF' + csv, 'utf16le'));
  const days = parseGooglePlayInstalls(text, pkg, '202609');
  expect(days).toEqual([
    { date: '2026-09-09', downloads: 3, deviceInstalls: 4, activeDeviceInstalls: 7, updates: 1, reportAvailable: true },
    { date: '2026-09-10', downloads: 0, deviceInstalls: 0, activeDeviceInstalls: 8, updates: 2, reportAvailable: true },
  ]);
  const summary = storeSummary('google', days, ['2026-09-09', '2026-09-10', '2026-09-11']);
  expect(summary.downloads).toBe(3);
  expect(summary.latest?.activeDeviceInstalls).toBe(8); // latest gauge, not 7 + 8
  expect(summary.reportingTimezone).toBe('America/Los_Angeles');
  expect(summary.complete).toBe(false);
});

it('does not turn a suppressed country or an empty report into a zero', () => {
  expect(parseGooglePlayInstalls(csv.replace('US,2,3', 'US,,3'), pkg, '202609').map(d => d.date)).toEqual(['2026-09-10']);
  expect(parseGooglePlayInstalls(header, pkg, '202609')).toEqual([]);
  const summary = storeSummary('google', [], ['2026-09-09']);
  expect(summary.downloads).toBeNull();
});

it('rejects another package, duplicate countries, invalid counts and dates', () => {
  for (const bad of [csv.replace(pkg, 'tech.spaceexplorer.spacerace'), `${csv}\n2026-09-09,${pkg},US,2,3,5,1`,
    csv.replace('US,2,3', 'US,-1,3'), csv.replace('2026-09-09', '2026-09-31')]) {
    expect(() => parseGooglePlayInstalls(bad, pkg, '202609')).toThrow();
  }
  expect(() => parseGooglePlayInstalls(csv, pkg, '202608')).toThrow();
});

it('requires Fable credentials explicitly and never falls back to other Google accounts', () => {
  const env = { GA4_KEY_JSON: 'other-account', GOOGLE_PLAY_KEY_JSON: 'other-play', FABLE_PLAY_KEY_JSON: 'fable' };
  expect(googlePlayCredentials('fable-designer', env)).toEqual({ keyJson: 'fable', bucket: undefined });
  expect(googlePlayCredentials('space-race', env)).toEqual({ keyJson: 'fable', bucket: undefined }); // same Play org account
  expect(googlePlayCredentials('animal-penpals', env)).toEqual({ keyJson: undefined, bucket: undefined });
});

function configure() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T13:00:00Z'));
  vi.stubEnv('FABLE_PLAY_KEY_JSON', JSON.stringify({ type: 'service_account', client_email: 'fixture@example.test', private_key: 'fixture-private-key' }));
  vi.stubEnv('FABLE_PLAY_REPORT_BUCKET', 'pubsite_prod_rev_123456');
}

it('reads only the selected package and country report through the read-only Storage API', async () => {
  configure();
  const fetcher = vi.fn().mockResolvedValue(new Response(Buffer.from('\uFEFF' + csv, 'utf16le')));
  vi.stubGlobal('fetch', fetcher);
  const report = await loadGooglePlay('fable-designer', '7d');
  expect(report.downloads.available).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toContain(`installs_${pkg}_202609_country.csv?alt=media`);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer fixture-token' } });
});

it('distinguishes delayed exports from denied access and never returns provider secrets', async () => {
  configure();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
  expect((await loadGooglePlay('fable-designer', '7d')).connectionReason).toContain('not provided install reports');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret provider body', { status: 403 })));
  const report = await loadGooglePlay('fable-designer', '7d');
  expect(report.connectionReason).toContain('denied access');
  expect(JSON.stringify(report)).not.toContain('secret provider body');
  expect(report.downloads.timeseries).toEqual([]);
});
