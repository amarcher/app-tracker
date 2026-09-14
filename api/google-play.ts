import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadGooglePlay } from './_shared/google-play.js';
import { STORE_APPS } from './_shared/store-apps.js';
import type { StoreDay } from '../src/types/business.js';

// Public project view for Google Play: a thin wrapper over the shared Play
// Console export reader the private Businesses collector uses. Days Google has
// not published stay absent rather than reading as zero.

const RANGES = ['1d', '7d', '30d', '90d'];

export function summarizeInstalls(timeseries: StoreDay[]) {
  const latest = timeseries.at(-1);
  if (!latest) return null;
  const deviceInstalls = timeseries.reduce<number | null>(
    (sum, day) => sum === null || day.deviceInstalls == null ? null : sum + day.deviceInstalls, 0);
  return {
    userInstalls: timeseries.reduce((sum, day) => sum + day.downloads, 0),
    deviceInstalls,
    latestDate: latest.date,
    latestActiveDeviceInstalls: latest.activeDeviceInstalls ?? null,
  };
}

export async function loadGooglePlayPanel(project: string, range: string) {
  const app = STORE_APPS[project];
  if (!app?.googlePrefix) return { connected: false, reason: `No Google Play app configured for ${project}`, app: null };
  const report = await loadGooglePlay(project, RANGES.includes(range) ? range : '30d');
  const totals = report.downloads.available ? summarizeInstalls(report.downloads.timeseries) : null;
  return {
    connected: true,
    app: { name: app.name, packageName: app.packageName },
    installs: totals
      ? { available: true as const, timeseries: report.downloads.timeseries, totals }
      : { available: false as const, reason: report.connectionReason ?? 'No Google Play report is available for this period.' },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const data = await loadGooglePlayPanel(String(req.query.project || ''), String(req.query.range || '30d'));
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.json(data);
  } catch { res.status(503).json({ error: 'Google Play data is unavailable.' }); }
}
