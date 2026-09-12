#!/usr/bin/env node
/**
 * Ingest Amazon Appstore Acquisition and Engagement CSVs into Neon.
 *
 * Amazon publishes installs and active users through the Developer Console
 * only: the Reporting API covers sales, earnings and subscriptions, and both
 * the acquisition and engagement docs state outright that downloading them
 * through the Reporting API isn't supported. So this is a manual hop —
 * download the monthly CSVs and feed them in:
 *
 *   My Reports > Download Center > Acquisition Reports / Engagement Reports
 *   node scripts/ingest-amazon-reports.mjs ~/Downloads/*.csv
 *
 * Report type is detected from the columns, so the two can be mixed in one
 * run and re-ingesting a month is safe (rows upsert on date + device +
 * marketplace). Amazon's own lag is 72h for acquisition, 96h for engagement.
 *
 * Options:
 *   --project <key>   dashboard project key (default: space-race)
 *   --dry-run         parse and summarize without writing
 */
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import { STORE_APPS } from '../api/_shared/store-apps.ts';

const args = process.argv.slice(2);
const files = [];
let project = 'space-race';
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project') project = args[++i];
  else if (args[i] === '--dry-run') dryRun = true;
  else if (args[i].startsWith('--')) throw new Error(`Unknown option: ${args[i]}`);
  else files.push(args[i]);
}
const app = STORE_APPS[project];
if (!app) throw new Error('Choose a known dashboard project with an app ASIN');

if (files.length === 0) {
  console.error('Usage: node scripts/ingest-amazon-reports.mjs [--project space-race] [--dry-run] <report.csv>...');
  process.exit(1);
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

// Amazon has renamed report columns before — match on a normalized name, and
// accept any of several spellings for the same field.
function pick(row, ...candidates) {
  for (const candidate of candidates) {
    const wanted = norm(candidate);
    const hit = Object.keys(row).find((k) => norm(k) === wanted);
    if (hit && row[hit] !== '') return row[hit];
  }
  return undefined;
}

const num = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v ?? '').replace(/[,%]/g, ''));
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

// Amazon writes dates as YYYY-MM-DD in these reports, but has used MM/DD/YYYY
// in others — normalize both.
function isoDate(value) {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const us = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return null;
}

const records = new Map();

function upsertLocal(date, deviceType, marketplace, fields) {
  const key = `${date}|${deviceType}|${marketplace}`;
  records.set(key, { date, deviceType, marketplace, ...(records.get(key) ?? {}), ...fields });
}

for (const file of files) {
  const rows = parseCsv(readFileSync(file, 'utf8'));
  if (rows.length === 0) {
    console.warn(`${file}: no rows, skipping`);
    continue;
  }

  const columns = Object.keys(rows[0]).map(norm);
  const isAcquisition = columns.some((c) => c.includes('install'));
  const isEngagement = columns.some((c) => c.includes('dailyactiveusers') || c === 'dau');
  if (!isAcquisition && !isEngagement) {
    console.warn(`${file}: not an acquisition or engagement report (columns: ${Object.keys(rows[0]).join(', ')}), skipping`);
    continue;
  }

  let used = 0;
  for (const row of rows) {
    if (pick(row, 'App ASIN', 'ASIN') !== app.asin) continue;
    const date = isoDate(pick(row, 'Date'));
    if (!date) continue;
    const deviceType = pick(row, 'Device Type') ?? 'all';
    const marketplace = pick(row, 'Marketplace') ?? 'all';

    if (isAcquisition) {
      upsertLocal(date, deviceType, marketplace, {
        acquisition: true,
        asin: pick(row, 'App ASIN', 'ASIN') ?? null,
        appName: pick(row, 'App Name', 'Title') ?? null,
        dailyInstallsUnique: num(pick(row, 'Daily Installs (unique)', 'Daily Installs Unique', 'Daily Installs')),
        dailyInstallEvents: num(pick(row, 'Daily Install Events')),
        currentUserInstalls: num(pick(row, 'Current User Installs')),
      });
    }
    if (isEngagement) {
      upsertLocal(date, deviceType, marketplace, {
        engagement: true,
        asin: pick(row, 'App ASIN', 'ASIN') ?? null,
        appName: pick(row, 'App Name', 'Title') ?? null,
        dau: num(pick(row, 'Daily Active Users (DAU)', 'Daily Active Users', 'DAU')),
        wau: num(pick(row, 'Weekly Active Users (WAU)', 'Weekly Active Users', 'WAU')),
        mau: num(pick(row, 'Monthly Active Users (MAU)', 'Monthly Active Users', 'MAU')),
      });
    }
    used++;
  }
  console.log(`${file}: ${isAcquisition ? 'acquisition' : 'engagement'}, ${used}/${rows.length} rows`);
}

const all = [...records.values()].sort((a, b) => a.date.localeCompare(b.date));
if (all.length === 0) {
  console.error('Nothing to ingest.');
  process.exit(1);
}
console.log(`\n${all.length} day/device/marketplace rows for "${project}", ${all[0].date} → ${all[all.length - 1].date}`);

if (dryRun) {
  console.table(all.slice(-10));
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (put it in .env).');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS amazon_appstore_stats (
    project TEXT NOT NULL,
    date DATE NOT NULL,
    device_type TEXT NOT NULL DEFAULT 'all',
    marketplace TEXT NOT NULL DEFAULT 'all',
    asin TEXT,
    app_name TEXT,
    daily_installs_unique INTEGER,
    daily_install_events INTEGER,
    current_user_installs INTEGER,
    dau INTEGER,
    wau INTEGER,
    mau INTEGER,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (project, date, device_type, marketplace)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS amazon_appstore_stats_project_date ON amazon_appstore_stats (project, date)`;

// Replace even a suppressed count when that report type is present. Keep the
// other report type intact; a refreshed acquisition file must not erase DAU.
for (const r of all) {
  await sql`
    INSERT INTO amazon_appstore_stats (
      project, date, device_type, marketplace, asin, app_name,
      daily_installs_unique, daily_install_events, current_user_installs, dau, wau, mau
    ) VALUES (
      ${project}, ${r.date}, ${r.deviceType}, ${r.marketplace}, ${r.asin ?? null}, ${r.appName ?? null},
      ${r.dailyInstallsUnique ?? null}, ${r.dailyInstallEvents ?? null}, ${r.currentUserInstalls ?? null},
      ${r.dau ?? null}, ${r.wau ?? null}, ${r.mau ?? null}
    )
    ON CONFLICT (project, date, device_type, marketplace) DO UPDATE SET
      asin = COALESCE(EXCLUDED.asin, amazon_appstore_stats.asin),
      app_name = COALESCE(EXCLUDED.app_name, amazon_appstore_stats.app_name),
      daily_installs_unique = CASE WHEN ${!!r.acquisition} THEN EXCLUDED.daily_installs_unique ELSE amazon_appstore_stats.daily_installs_unique END,
      daily_install_events = CASE WHEN ${!!r.acquisition} THEN EXCLUDED.daily_install_events ELSE amazon_appstore_stats.daily_install_events END,
      current_user_installs = CASE WHEN ${!!r.acquisition} THEN EXCLUDED.current_user_installs ELSE amazon_appstore_stats.current_user_installs END,
      dau = CASE WHEN ${!!r.engagement} THEN EXCLUDED.dau ELSE amazon_appstore_stats.dau END,
      wau = CASE WHEN ${!!r.engagement} THEN EXCLUDED.wau ELSE amazon_appstore_stats.wau END,
      mau = CASE WHEN ${!!r.engagement} THEN EXCLUDED.mau ELSE amazon_appstore_stats.mau END,
      updated_at = NOW()
  `;
}

console.log(`Ingested ${all.length} rows into amazon_appstore_stats.`);
