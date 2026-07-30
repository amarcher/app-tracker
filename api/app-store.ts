import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPrivateKey, sign } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

// App Store Connect app IDs per dashboard project
const APPS: Record<string, string | undefined> = {
  'space-race': process.env.APP_STORE_APP_ID_SPACE_RACE,
};

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

  const perDay = await Promise.all(
    dates.map(async (date) => {
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
      if (res.status === 404) return { date, downloads: 0, updates: 0, redownloads: 0 };
      if (!res.ok) throw new Error(`salesReports ${res.status} for ${date}`);
      const tsv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
      const [headerLine, ...rows] = tsv.split('\n').filter(Boolean);
      const cols = headerLine.split('\t');
      const idx = {
        units: cols.indexOf('Units'),
        productType: cols.indexOf('Product Type Identifier'),
        appleId: cols.indexOf('Apple Identifier'),
      };
      let downloads = 0;
      let updates = 0;
      let redownloads = 0;
      for (const row of rows) {
        const f = row.split('\t');
        if (f[idx.appleId] !== appId) continue;
        const units = Number(f[idx.units]) || 0;
        const type = f[idx.productType] ?? '';
        if (type.startsWith('1')) downloads += units;
        else if (type.startsWith('7')) updates += units;
        else if (type.startsWith('3')) redownloads += units;
      }
      return { date, downloads, updates, redownloads };
    }),
  );

  const totals = perDay.reduce(
    (acc, d) => ({
      downloads: acc.downloads + d.downloads,
      updates: acc.updates + d.updates,
      redownloads: acc.redownloads + d.redownloads,
    }),
    { downloads: 0, updates: 0, redownloads: 0 },
  );
  return { available: true as const, timeseries: perDay, totals };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const project = (req.query.project as string) || '';
    const range = (req.query.range as string) || '30d';
    const days = Math.min(parseInt(range.replace('d', ''), 10) || 30, 30);

    const appId = APPS[project];
    if (!appId) {
      return res.json({ connected: false, reason: `No App Store app configured for ${project}` });
    }

    const keyId = process.env.ASC_KEY_ID;
    const issuerId = process.env.ASC_ISSUER_ID;
    const privateKey = process.env.ASC_PRIVATE_KEY;
    const vendorNumber = process.env.ASC_VENDOR_NUMBER;
    if (!keyId || !issuerId || !privateKey) {
      const itunes = await fetchItunesLookup(appId);
      return res.json({
        connected: !!itunes,
        reason: 'ASC API key not configured; showing public data only',
        app: itunes,
        reviews: [],
        downloads: { available: false, reason: 'ASC API key not configured' },
      });
    }

    const token = makeAscToken(keyId, issuerId, privateKey);
    // Sales and Trends needs a key with the Sales/Finance/Admin role, which the
    // main (App Manager) key may lack — allow a dedicated key pair for it.
    const salesKeyId = process.env.ASC_SALES_KEY_ID;
    const salesPrivateKey = process.env.ASC_SALES_PRIVATE_KEY;
    const salesToken = salesKeyId && salesPrivateKey ? makeAscToken(salesKeyId, issuerId, salesPrivateKey) : token;
    const [itunes, reviews, downloads] = await Promise.all([
      fetchItunesLookup(appId),
      fetchReviews(appId, token),
      vendorNumber
        ? fetchDailyUnits(appId, vendorNumber, salesToken, days).catch((err) => ({
            available: false as const,
            reason: String(err?.message ?? err),
          }))
        : Promise.resolve({ available: false as const, reason: 'ASC_VENDOR_NUMBER not configured' }),
    ]);

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.json({ connected: true, app: itunes, reviews, downloads });
  } catch (error) {
    console.error('App Store query error:', error);
    res.status(500).json({ error: 'Failed to fetch App Store data' });
  }
}
