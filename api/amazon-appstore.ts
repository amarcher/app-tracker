import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { gunzipSync, inflateRawSync } from 'node:zlib';

import { STORE_APPS } from './_shared/store-apps.js';

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
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) throw new Error('An explicit app ASIN is required');
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const byDate = new Map<string, number>();
  const coveredMonths = new Set<string>();

  for (const { year, month } of monthsInRange(days)) {
    const url = `${REPORTING_BASE}/sales/${year}/${String(month).padStart(2, '0')}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) continue;

    // A month Amazon has no report for answers "400 Report not found" rather
    // than a 404. Keep its dates unavailable; absence is not evidence of zero
    // acquisitions. Other 400s are real failures and surface.
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
    if (!downloadUrl?.startsWith('https://')) throw new Error('Invalid report download address');

    // Presigned URL — sending the LWA token would break the signature.
    const file = await fetch(downloadUrl);
    if (!file.ok) throw new Error(`report download → ${file.status}`);
    const rows = parseCsv(unpackReport(Buffer.from(await file.arrayBuffer())));
    coveredMonths.add(`${year}-${String(month).padStart(2, "0")}`);

    for (const row of rows) {
      if (pick(row, 'ASIN', 'App ASIN') !== asin) continue;
      const itemType = (pick(row, 'Item Type') ?? '').toLowerCase();
      if (itemType.includes('iap') || itemType.includes('subscription') || itemType.includes('in-app')) continue;
      const date = isoDate(pick(row, 'Transaction Time', 'Transaction Date', 'Date'));
      if (!date || date < since) continue;
      const units = pick(row, 'Units');
      if (!units?.trim() || !Number.isSafeInteger(Number(units))) throw new Error('Unrecognized app units in report');
      byDate.set(date, (byDate.get(date) ?? 0) + Number(units));
    }
  }

  const timeseries: { date: string; downloads: number; reportAvailable: boolean }[] = [];
  for (let i = days; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    timeseries.push({ date, downloads: byDate.get(date) ?? 0, reportAvailable: coveredMonths.has(date.slice(0, 7)) });
  }
  return {
    available: true as const,
    complete: timeseries.every(row => row.reportAvailable),
    reportingTimezone: "UTC",
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

  // Filter the ASIN on reads too: legacy imports could have mixed apps.
  const rows = await sql`
    SELECT to_char(date, 'YYYY-MM-DD') AS date, device_type, marketplace,
      daily_installs_unique, daily_install_events, current_user_installs, dau, wau, mau
    FROM amazon_appstore_stats
    WHERE project=${project} AND asin=${STORE_APPS[project]?.asin ?? ''} AND date >= ${since}
    ORDER BY date
  `;
  if (rows.length === 0) return noReports;
  return summarizeIngestedStats(rows);

}

// Unique users cannot be added across overlapping segments or replaced by
// the largest segment. Only Amazon's explicit all-device/all-marketplace row
// supports a portfolio total. Keep unavailable/suppressed cells null.
export function summarizeIngestedStats(rows: Record<string, unknown>[]) {
  const all = (value: unknown) => /^(all|all devices|all device types|all marketplaces|total)$/i.test(String(value).trim());
  const number = (value: unknown) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const timeseries = [...new Set(rows.map(row => String(row.date)))].sort().map(date => {
    const rollups = rows.filter(row => row.date === date && all(row.device_type) && all(row.marketplace));
    const metric = (key: string) => rollups.length === 1 ? number(rollups[0][key]) : null;
    return { date, installs: metric('daily_installs_unique'), installEvents: metric('daily_install_events'),
      currentInstalls: metric('current_user_installs'), dau: metric('dau'), wau: metric('wau'), mau: metric('mau') };
  });
  const latest = timeseries.at(-1)!;
  const active = timeseries.flatMap(row => row.dau === null ? [] : [row.dau]);
  return { available: true as const, timeseries,
    note: 'Unique metrics require an All devices / All marketplaces report row. Segmented or suppressed totals remain unavailable.',
    totals: { installs: timeseries.some(row => row.installs === null) ? null : timeseries.reduce((sum, row) => sum + row.installs!, 0),
      currentInstalls: latest.currentInstalls, latestDate: latest.date, latestDau: latest.dau, latestWau: latest.wau, latestMau: latest.mau,
      avgDau: active.length ? Math.round(active.reduce((sum, value) => sum + value, 0) / active.length) : null,
      peakDau: active.length ? Math.max(...active) : null } };
}

export async function loadAmazonAppstore(project: string, range = '30d') {
    const days = Math.min(parseInt(range.replace('d', ''), 10) || 30, 90);

    const app = STORE_APPS[project];
    if (!app) {
      return ({ connected: false, reason: `No Amazon Appstore app configured for ${project}` });
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

    return { connected: true, app: { name: app.name, packageName: app.packageName, asin: app.asin }, downloads, stats };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const data = await loadAmazonAppstore(String(req.query.project || ''), String(req.query.range || '30d'));
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.json(data);
  } catch { res.status(503).json({ error: 'Amazon Appstore data is unavailable.' }); }
}
