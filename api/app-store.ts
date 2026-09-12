import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPrivateKey, sign } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { STORE_APPS, mapBounded, appleCredentials } from './_shared/store-apps.js';

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

// ES256-signed JWT for the App Store Connect API
function makeAscToken(keyId: string, issuerId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }));
  const key = createPrivateKey(privateKeyPem);
  const sig = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}

async function fetchItunesLookup(appId: string) {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${appId}&country=us`);
  if (!res.ok) return null;
  const data = await res.json();
  const app = data.results?.[0];
  if (!app) return null;
  return {
    name: app.trackName as string,
    version: app.version as string,
    releaseDate: app.releaseDate as string,
    currentVersionReleaseDate: app.currentVersionReleaseDate as string,
    minimumOsVersion: app.minimumOsVersion as string,
    rating: { average: (app.averageUserRating as number) ?? null, count: (app.userRatingCount as number) ?? 0 },
    url: app.trackViewUrl as string,
  };
}

async function fetchReviews(appId: string, token: string) {
  const res = await fetch(
    `https://api.appstoreconnect.apple.com/v1/apps/${appId}/customerReviews?limit=10&sort=-createdDate`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data ?? []).map((r: any) => ({
    rating: r.attributes.rating as number,
    title: r.attributes.title as string,
    body: r.attributes.body as string,
    reviewer: r.attributes.reviewerNickname as string,
    date: r.attributes.createdDate as string,
    territory: r.attributes.territory as string,
  }));
}

// Daily Sales & Trends summary report: gzipped TSV, one report per day.
// Reports lag ~1 day and 404 when there was no activity for that date.
async function fetchDailyUnits(appId: string, vendorNumber: string, token: string, days: number) {
  const dates: string[] = [];
  for (let i = days; i >= 1; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    dates.push(d.toISOString().slice(0, 10));
  }

  const perDay = await mapBounded(
    dates, async (date) => {
      const params = new URLSearchParams({
        'filter[frequency]': 'DAILY',
        'filter[reportType]': 'SALES',
        'filter[reportSubType]': 'SUMMARY',
        'filter[vendorNumber]': vendorNumber,
        'filter[reportDate]': date,
      });
      const res = await fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/a-gzip' },
      });
      if (res.status === 404) return { date, downloads: 0, updates: 0, redownloads: 0, reportAvailable: false };
      if (!res.ok) throw new Error(`salesReports ${res.status} for ${date}`);
      const tsv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
      const [headerLine, ...rows] = tsv.split('\n').filter(Boolean);
      const cols = headerLine.split('\t').map(column => column.trim());
      const idx = {
        units: cols.indexOf('Units'),
        productType: cols.indexOf('Product Type Identifier'),
        appleId: cols.indexOf('Apple Identifier'),
      };
      if (Object.values(idx).some(index => index < 0)) throw new Error('Unrecognized sales report columns');
      let downloads = 0;
      let updates = 0;
      let redownloads = 0;
      for (const row of rows) {
        const f = row.split('\t');
        if (f[idx.appleId] !== appId) continue;
        const units = Number(f[idx.units]);
        if (!f[idx.units]?.trim() || !Number.isSafeInteger(units)) throw new Error('Invalid sales report units');
        const type = f[idx.productType] ?? '';
        if (type.startsWith('1')) downloads += units;
        else if (type.startsWith('7')) updates += units;
        else if (type.startsWith('3')) redownloads += units;
      }
      return { date, downloads, updates, redownloads, reportAvailable: true };
    },
  );

  const totals = perDay.reduce(
    (acc, d) => ({
      downloads: acc.downloads + d.downloads,
      updates: acc.updates + d.updates,
      redownloads: acc.redownloads + d.redownloads,
    }),
    { downloads: 0, updates: 0, redownloads: 0 },
  );
  return { available: true as const, timeseries: perDay, totals, complete: perDay.every(day => day.reportAvailable), reportingTimezone: 'America/Los_Angeles' };
}

const ASC_BASE = 'https://api.appstoreconnect.apple.com';

async function ascGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${ASC_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path.split('?')[0]} → ${res.status}`);
  return res.json();
}

// Analytics report files are gzipped and tab-separated (despite the .csv.gz
// name), one header row plus one row per dimension combination.
function parseReportRows(tsv: string): Record<string, string>[] {
  const [headerLine, ...lines] = tsv.split('\n').filter(Boolean);
  if (!headerLine) return [];
  const delimiter = headerLine.includes('\t') ? '\t' : ',';
  const cols = headerLine.split(delimiter).map((c) => c.trim());
  return lines.map((line) => {
    const fields = line.split(delimiter);
    return Object.fromEntries(cols.map((c, i) => [c, (fields[i] ?? '').trim()]));
  });
}

/**
 * Daily active devices and sessions from the App Store Connect Analytics
 * Reports API (the same numbers as the Analytics tab in App Store Connect).
 *
 * Apple only generates these once an ADMIN-role API key opts the app in via
 * `POST /v1/analyticsReportRequests` (see `scripts/asc-analytics-request.mjs`);
 * a Sales and Reports key can read them but cannot create the request. Data
 * lags ~1 day, so the most recent day here is usually yesterday.
 *
 * Note on active devices: Apple pre-aggregates "Unique Devices" per row, where
 * rows are split by app version, device, territory, source type and so on. A
 * device active on two app versions in one day therefore counts twice in the
 * daily sum. Sessions are exact.
 */
async function fetchDailyActivity(appId: string, token: string, days: number) {
  const requests = await ascGet(`/v1/apps/${appId}/analyticsReportRequests?limit=50`, token);
  // Prefer the ONGOING request (refreshed daily); the one-time snapshot only
  // covers history up to the day it was created.
  const candidates = (requests.data ?? [])
    .filter((r: any) => !r.attributes?.stoppedDueToInactivity)
    .sort((a: any) => (a.attributes?.accessType === 'ONGOING' ? -1 : 1));
  if (candidates.length === 0) {
    return {
      available: false as const,
      reason: 'No analytics report request exists for this app — run scripts/asc-analytics-request.mjs with an Admin ASC key',
    };
  }

  let reportId: string | null = null;
  for (const request of candidates) {
    const reports = await ascGet(
      `/v1/analyticsReportRequests/${request.id}/reports?filter[category]=APP_USAGE&limit=200`,
      token,
    );
    const sessions = (reports.data ?? []).find((r: any) => r.attributes?.name === 'App Sessions Standard')
      ?? (reports.data ?? []).find((r: any) => String(r.attributes?.name ?? '').startsWith('App Sessions'));
    if (sessions) {
      reportId = sessions.id;
      break;
    }
  }
  if (!reportId) {
    return { available: false as const, reason: 'Apple has not generated the App Sessions report yet — it lands within ~48h of the request' };
  }

  const startDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const instances = await ascGet(
    `/v1/analyticsReports/${reportId}/instances?filter[granularity]=DAILY&limit=200`,
    token,
  );
  const wanted = (instances.data ?? [])
    .filter((i: any) => (i.attributes?.processingDate ?? '') >= startDate)
    .sort((a: any, b: any) => String(b.attributes.processingDate).localeCompare(a.attributes.processingDate))
    .slice(0, days);
  if (wanted.length === 0) {
    return { available: false as const, reason: 'No daily report instances yet for this date range' };
  }

  const byDate = new Map<string, { date: string; activeDevices: number; sessions: number }>();
  await Promise.all(
    wanted.map(async (instance: any) => {
      const segments = await ascGet(`/v1/analyticsReportInstances/${instance.id}/segments?limit=200`, token);
      for (const segment of segments.data ?? []) {
        // Pre-signed S3 URL — sending the ASC bearer token would break the signature.
        const file = await fetch(segment.attributes.url);
        if (!file.ok) continue;
        const rows = parseReportRows(gunzipSync(Buffer.from(await file.arrayBuffer())).toString('utf8'));
        for (const row of rows) {
          const date = row['Date'] || instance.attributes.processingDate;
          const entry = byDate.get(date) ?? { date, activeDevices: 0, sessions: 0 };
          entry.activeDevices += Number(row['Unique Devices']) || 0;
          entry.sessions += Number(row['Sessions']) || 0;
          byDate.set(date, entry);
        }
      }
    }),
  );

  // Zero-fill inside the window Apple actually covers, so a quiet day reads as
  // 0 rather than a gap in the chart.
  const covered = [...byDate.keys()].sort();
  const timeseries: { date: string; activeDevices: number; sessions: number }[] = [];
  if (covered.length > 0) {
    for (let d = new Date(`${covered[0]}T00:00:00Z`); d.toISOString().slice(0, 10) <= covered[covered.length - 1]; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      timeseries.push(byDate.get(date) ?? { date, activeDevices: 0, sessions: 0 });
    }
  }

  const latest = timeseries[timeseries.length - 1] ?? null;
  return {
    available: true as const,
    timeseries,
    totals: {
      avgActiveDevices: timeseries.length > 0
        ? Math.round(timeseries.reduce((s, d) => s + d.activeDevices, 0) / timeseries.length)
        : 0,
      peakActiveDevices: timeseries.reduce((m, d) => Math.max(m, d.activeDevices), 0),
      sessions: timeseries.reduce((s, d) => s + d.sessions, 0),
      latestDate: latest?.date ?? null,
      latestActiveDevices: latest?.activeDevices ?? 0,
    },
  };
}

export async function loadAppStore(project: string, range = '30d') {
    const days = Math.min(parseInt(range.replace('d', ''), 10) || 30, 90);

    const appId = STORE_APPS[project]?.appleId;
    if (!appId) {
      return ({ connected: false, reason: `No App Store app configured for ${project}` });
    }

    const credentials = appleCredentials(project);
    const { keyId, issuerId, privateKey, vendorNumber } = credentials;
    if (!keyId || !issuerId || !privateKey) {
      const itunes = await fetchItunesLookup(appId);
      return ({
        connected: !!itunes,
        reason: 'ASC API key not configured; showing public data only',
        app: itunes,
        reviews: [],
        downloads: { available: false, reason: 'ASC API key not configured' },
        activity: { available: false, reason: 'ASC API key not configured' },
      });
    }

    const token = makeAscToken(keyId, issuerId, privateKey);
    // Sales and Trends needs a key with the Sales/Finance/Admin role, which the
    // main (App Manager) key may lack — allow a dedicated key pair for it.
    const salesKeyId = credentials.salesKeyId;
    const salesPrivateKey = credentials.salesPrivateKey;
    const salesToken = salesKeyId && salesPrivateKey ? makeAscToken(salesKeyId, issuerId, salesPrivateKey) : token;
    // Analytics reports need Admin, Sales and Reports, or Finance — the same
    // roles as Sales and Trends, so reuse that key unless one is set explicitly.
    const analyticsKeyId = credentials.analyticsKeyId;
    const analyticsPrivateKey = credentials.analyticsPrivateKey;
    const analyticsToken = analyticsKeyId && analyticsPrivateKey
      ? makeAscToken(analyticsKeyId, issuerId, analyticsPrivateKey)
      : salesToken;
    const [itunes, reviews, downloads, activity] = await Promise.all([
      fetchItunesLookup(appId),
      fetchReviews(appId, token),
      vendorNumber
        ? fetchDailyUnits(appId, vendorNumber, salesToken, days).catch((err) => ({
            available: false as const,
            reason: String(err?.message ?? err),
          }))
        : Promise.resolve({ available: false as const, reason: 'ASC_VENDOR_NUMBER not configured' }),
      fetchDailyActivity(appId, analyticsToken, days).catch((err) => ({
        available: false as const,
        reason: String(err?.message ?? err),
      })),
    ]);

    return { connected: true, app: itunes, reviews, downloads, activity };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const data = await loadAppStore(String(req.query.project || ''), String(req.query.range || '30d'));
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.json(data);
  } catch { res.status(503).json({ error: 'App Store data is unavailable.' }); }
}
