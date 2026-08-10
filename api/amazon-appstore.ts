import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { gunzipSync, inflateRawSync } from 'node:zlib';

// Amazon Appstore apps per dashboard project. The ASIN filters the sales
// report; leave it unset on a single-app account and every row counts.
const APPS: Record<string, { asin?: string; packageName: string } | undefined> = {
  'space-race': {
    asin: process.env.AMAZON_ASIN_SPACE_RACE,
    packageName: 'tech.spaceexplorer.spacerace',
  },
};

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const REPORTING_SCOPE = 'adx_reporting::appstore:marketer';
const REPORTING_BASE = 'https://developer.amazon.com/api/appstore/download/report';

async function getLwaToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: REPORTING_SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`LWA token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token as string;
}

/**
 * Amazon hands back a presigned S3 URL to a *zipped* CSV. Node ships zlib but
 * no zip reader, so unwrap the archive by hand: walk local file headers, and
 * inflate the first entry (stored and deflate are the only methods Amazon
 * uses). Falls back to gzip and to plain text so a format change degrades to a
 * parse error rather than a crash.
 */
export function unpackReport(buf: Buffer): string {
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const method = buf.readUInt16LE(8);
    const compressedSize = buf.readUInt32LE(18);
    const nameLength = buf.readUInt16LE(26);
    const extraLength = buf.readUInt16LE(28);
    const start = 30 + nameLength + extraLength;
    // A streamed zip writes sizes to the trailing data descriptor and leaves
    // the header at 0 — inflate to the end of the buffer in that case.
    const end = compressedSize > 0 ? start + compressedSize : buf.length;
    const body = buf.subarray(start, end);
    return method === 0 ? body.toString('utf8') : inflateRawSync(body).toString('utf8');
  }
  if (buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf).toString('utf8');
  return buf.toString('utf8');
}

// Amazon's report CSVs are comma-separated with quoted fields that may contain
// commas — enough of RFC 4180 to read them correctly.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  const [header, ...body] = rows.filter((r) => r.some((f) => f.trim() !== ''));
  if (!header) return [];
  const cols = header.map((c) => c.trim());
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}

// Amazon has renamed report columns before, so match on a normalized name
// rather than an exact string.
export function pick(row: Record<string, string>, ...candidates: string[]): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const candidate of candidates) {
    const wanted = norm(candidate);
    const hit = Object.keys(row).find((k) => norm(k) === wanted);
    if (hit) return row[hit];
  }
  return undefined;
}

// Amazon writes "Transaction Time" as an ISO timestamp in the current sales
// report but has used MM/DD/YYYY in others — accept both rather than silently
// dropping every row.
export function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return null;
}

function monthsInRange(days: number): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  const seen = new Set<string>();
  for (let i = days; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  return months;
}

/**
 * Daily downloads from the Appstore Reporting API's monthly sales report.
 *
 * A free app still books one transaction row per acquisition (Sales Price 0),
 * which is what the console's "Units" page counts — so summing app-type units
 * per day gives downloads. IAP and subscription rows are excluded by item
 * type; Space Race has neither, but the filter keeps this honest if that
 * changes. Reports are monthly, so a range spanning a month boundary fetches
 * both and trims to the window.
 */
export async function fetchDownloads(asin: string | undefined, token: string, days: number) {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const byDate = new Map<string, number>();

  for (const { year, month } of monthsInRange(days)) {
    const url = `${REPORTING_BASE}/sales/${year}/${String(month).padStart(2, '0')}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) continue;

    // A month Amazon has no report for answers "400 Report not found" rather
    // than a 404 — that is a quiet month, not a failure, and any range longer
    // than the app has been live will hit it. Other 400s are real and surface.
    const body = (await res.text()).trim();
    if (res.status === 400 && /report not found/i.test(body)) continue;
    if (!res.ok) throw new Error(`sales report ${year}-${month} → ${res.status}: ${body.slice(0, 120)}`);

    // On success the body is the presigned S3 URL itself (valid 5 minutes),
    // bare rather than wrapped — but tolerate a JSON envelope.
    let downloadUrl = body;
    if (body.startsWith('{')) {
      const parsed = JSON.parse(body);
      downloadUrl = parsed.url ?? parsed.downloadUrl ?? parsed.location;
    }
    if (!downloadUrl?.startsWith('http')) continue;

    // Presigned URL — sending the LWA token would break the signature.
    const file = await fetch(downloadUrl);
    if (!file.ok) throw new Error(`report download → ${file.status}`);
    const rows = parseCsv(unpackReport(Buffer.from(await file.arrayBuffer())));

    for (const row of rows) {
      if (asin && pick(row, 'ASIN') !== asin) continue;
      const itemType = (pick(row, 'Item Type') ?? '').toLowerCase();
      if (itemType.includes('iap') || itemType.includes('subscription') || itemType.includes('in-app')) continue;
      const date = isoDate(pick(row, 'Transaction Time', 'Transaction Date', 'Date'));
      if (!date || date < since) continue;
      byDate.set(date, (byDate.get(date) ?? 0) + (Number(pick(row, 'Units')) || 0));
    }
  }

  const timeseries: { date: string; downloads: number }[] = [];
  for (let i = days; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    timeseries.push({ date, downloads: byDate.get(date) ?? 0 });
  }
  return {
    available: true as const,
    timeseries,
    totals: { downloads: timeseries.reduce((s, d) => s + d.downloads, 0) },
  };
}

/**
 * Installs and active users from `amazon_appstore_stats`, populated by
 * `scripts/ingest-amazon-reports.mjs` from the Download Center CSVs.
 *
 * Amazon publishes no API for either report — the Reporting API covers sales,
 * earnings and subscriptions only, and the acquisition and engagement docs
 * both say so outright — so this half of the panel is as fresh as the last
 * ingest. Amazon's own lag is 72h for acquisition and 96h for engagement.
 */
async function fetchIngestedStats(project: string, days: number) {
  if (!process.env.DATABASE_URL) {
    return { available: false as const, reason: 'DATABASE_URL not configured' };
  }
  const sql = neon(process.env.DATABASE_URL);
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const noReports = {
    available: false as const,
    reason: 'No ingested Amazon reports yet — Amazon publishes installs and DAU only as Download Center CSVs (see scripts/ingest-amazon-reports.mjs)',
  };

  // The ingest script creates the table on its first run, so before then it
  // simply does not exist — that is "nothing ingested yet", not an error.
  const tableExists = (await sql`SELECT to_regclass('public.amazon_appstore_stats') AS t`) as { t: string | null }[];
  if (!tableExists[0]?.t) return noReports;

  // Rows are split by device type and marketplace. Installs sum cleanly across
  // those segments; active users do not, since one user on two devices would
  // count twice. MAX picks Amazon's rollup row when it emits one and the
  // largest single segment otherwise — an undercount, chosen deliberately over
  // the double-count that SUM would give.
  const rows = (await sql`
    SELECT
      to_char(date, 'YYYY-MM-DD') AS date,
      SUM(daily_installs_unique) AS installs,
      SUM(daily_install_events) AS install_events,
      MAX(current_user_installs) AS current_installs,
      MAX(dau) AS dau,
      MAX(wau) AS wau,
      MAX(mau) AS mau
    FROM amazon_appstore_stats
    WHERE project = ${project} AND date >= ${since}
    GROUP BY date
    ORDER BY date
  `) as Record<string, string | null>[];

  if (rows.length === 0) return noReports;

  const timeseries = rows.map((r) => ({
    date: r.date as string,
    installs: Number(r.installs) || 0,
    installEvents: Number(r.install_events) || 0,
    currentInstalls: Number(r.current_installs) || 0,
    dau: Number(r.dau) || 0,
    wau: Number(r.wau) || 0,
    mau: Number(r.mau) || 0,
  }));
  const latest = timeseries[timeseries.length - 1];
  const withDau = timeseries.filter((d) => d.dau > 0);

  return {
    available: true as const,
    timeseries,
    totals: {
      installs: timeseries.reduce((s, d) => s + d.installs, 0),
      currentInstalls: latest.currentInstalls,
      latestDate: latest.date,
      latestDau: latest.dau,
      latestWau: latest.wau,
      latestMau: latest.mau,
      avgDau: withDau.length > 0 ? Math.round(withDau.reduce((s, d) => s + d.dau, 0) / withDau.length) : 0,
      peakDau: timeseries.reduce((m, d) => Math.max(m, d.dau), 0),
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const project = (req.query.project as string) || '';
    const range = (req.query.range as string) || '30d';
    const days = Math.min(parseInt(range.replace('d', ''), 10) || 30, 90);

    const app = APPS[project];
    if (!app) {
      return res.json({ connected: false, reason: `No Amazon Appstore app configured for ${project}` });
    }

    const clientId = process.env.AMAZON_REPORTING_CLIENT_ID;
    const clientSecret = process.env.AMAZON_REPORTING_CLIENT_SECRET;

    const downloads = clientId && clientSecret
      ? await getLwaToken(clientId, clientSecret)
          .then((token) => fetchDownloads(app.asin, token, days))
          .catch((err) => ({ available: false as const, reason: String(err?.message ?? err) }))
      : {
          available: false as const,
          reason: 'AMAZON_REPORTING_CLIENT_ID/SECRET not configured — attach a security profile to the Reporting API in the Developer Console',
        };

    const stats = await fetchIngestedStats(project, days).catch((err) => ({
      available: false as const,
      reason: String(err?.message ?? err),
    }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.json({
      connected: true,
      app: { name: 'Space Race: 1000 Light Years', packageName: app.packageName, asin: app.asin ?? null },
      downloads,
      stats,
    });
  } catch (error) {
    console.error('Amazon Appstore query error:', error);
    res.status(500).json({ error: 'Failed to fetch Amazon Appstore data' });
  }
}
