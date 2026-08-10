#!/usr/bin/env node
/**
 * Verify the Amazon Appstore Reporting API credentials end to end.
 *
 * Checks the LWA token exchange, the sales report fetch, the zip unwrap and
 * the CSV parse, then prints what the dashboard would show. Reports never
 * echo the client ID or secret.
 *
 *   node scripts/check-amazon-api.mjs [YYYY-MM]
 *
 * Defaults to the current month.
 */
import 'dotenv/config';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const clientId = process.env.AMAZON_REPORTING_CLIENT_ID;
const clientSecret = process.env.AMAZON_REPORTING_CLIENT_SECRET;
const asin = process.env.AMAZON_ASIN_SPACE_RACE;

if (!clientId || !clientSecret) {
  console.error('AMAZON_REPORTING_CLIENT_ID and AMAZON_REPORTING_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const arg = process.argv[2];
const now = new Date();
const [year, month] = arg?.match(/^\d{4}-\d{2}$/)
  ? arg.split('-')
  : [String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0')];

function unpackReport(buf) {
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const method = buf.readUInt16LE(8);
    const compressedSize = buf.readUInt32LE(18);
    const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
    const body = buf.subarray(start, compressedSize > 0 ? start + compressedSize : buf.length);
    return method === 0 ? body.toString('utf8') : inflateRawSync(body).toString('utf8');
  }
  if (buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf).toString('utf8');
  return buf.toString('utf8');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
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

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function pick(row, ...candidates) {
  for (const candidate of candidates) {
    const wanted = norm(candidate);
    const hit = Object.keys(row).find((k) => norm(k) === wanted);
    if (hit) return row[hit];
  }
  return undefined;
}

console.log('1. Exchanging client credentials for an LWA token...');
const tokenRes = await fetch('https://api.amazon.com/auth/o2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'adx_reporting::appstore:marketer',
  }),
});
if (!tokenRes.ok) {
  console.error(`   FAILED (${tokenRes.status}): ${(await tokenRes.text()).slice(0, 300)}`);
  console.error('   If this says "invalid_client", the security profile is probably not attached');
  console.error('   to the Reporting API yet: My Settings > API Access > Reporting API.');
  process.exit(1);
}
const { access_token: token, expires_in: expiresIn } = await tokenRes.json();
console.log(`   OK — token valid for ${expiresIn}s`);

console.log(`2. Requesting the sales report for ${year}-${month}...`);
const reportRes = await fetch(
  `https://developer.amazon.com/api/appstore/download/report/sales/${year}/${month}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
if (reportRes.status === 404) {
  console.log('   404 — Amazon has no sales report for that month (no activity). Try another month.');
  process.exit(0);
}
if (!reportRes.ok) {
  console.error(`   FAILED (${reportRes.status}): ${(await reportRes.text()).slice(0, 300)}`);
  process.exit(1);
}
const body = (await reportRes.text()).trim();
const downloadUrl = body.startsWith('{')
  ? (JSON.parse(body).url ?? JSON.parse(body).downloadUrl ?? JSON.parse(body).location)
  : body;
console.log(`   OK — got a presigned URL (${new URL(downloadUrl).host})`);

console.log('3. Downloading and unpacking the report...');
const file = await fetch(downloadUrl);
if (!file.ok) {
  console.error(`   FAILED (${file.status}) fetching the presigned URL`);
  process.exit(1);
}
const raw = Buffer.from(await file.arrayBuffer());
const text = unpackReport(raw);
const rows = parseCsv(text);
console.log(`   OK — ${raw.length} bytes → ${rows.length} rows`);
if (rows.length > 0) console.log(`   Columns: ${Object.keys(rows[0]).join(', ')}`);

console.log('4. Counting downloads the way the dashboard does...');
const byDate = new Map();
let skippedAsin = 0;
let skippedIap = 0;
let skippedDate = 0;
for (const row of rows) {
  if (asin && pick(row, 'ASIN') !== asin) { skippedAsin++; continue; }
  const itemType = (pick(row, 'Item Type') ?? '').toLowerCase();
  if (itemType.includes('iap') || itemType.includes('subscription') || itemType.includes('in-app')) { skippedIap++; continue; }
  const rawDate = pick(row, 'Transaction Time', 'Transaction Date', 'Date') ?? '';
  const date = /^\d{4}-\d{2}-\d{2}/.test(rawDate.trim())
    ? rawDate.trim().slice(0, 10)
    : (rawDate.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
        ? (([, m, d, y]) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)(rawDate.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))
        : null);
  if (!date) { skippedDate++; continue; }
  byDate.set(date, (byDate.get(date) ?? 0) + (Number(pick(row, 'Units')) || 0));
}

const total = [...byDate.values()].reduce((s, n) => s + n, 0);
console.log(`\n   Downloads in ${year}-${month}: ${total}`);
for (const [date, count] of [...byDate.entries()].sort()) console.log(`     ${date}  ${count}`);
if (skippedAsin) console.log(`   (${skippedAsin} rows skipped: different ASIN)`);
if (skippedIap) console.log(`   (${skippedIap} rows skipped: IAP/subscription)`);
if (skippedDate) console.log(`   (${skippedDate} rows skipped: UNRECOGNIZED DATE FORMAT — check the column)`);

console.log('\nAll good. The dashboard route will return the same numbers.');
