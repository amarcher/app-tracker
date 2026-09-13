import { neon } from '@neondatabase/serverless';
import { loadAppStore } from '../app-store.js';
import { loadAmazonAppstore } from '../amazon-appstore.js';
import { STORE_APPS, storeSource, trustedLegacyStore } from './store-apps.js';
import type { BusinessDay, BusinessStore, BusinessSummary, BusinessTotals, StoreDay } from '../../src/types/business.js';

const DAY = 86400_000;
export const dayAt = (delta: number, now = Date.now()) => new Date(now + delta * DAY).toISOString().slice(0, 10);
export function summarizeBusinessDays(rows: BusinessDay[]): BusinessTotals {
  const count = (key: 'booksCreated' | 'paidFinishes' | 'subscriptionFinishes' | 'complimentaryFinishes' | 'printedCopies') => rows.reduce((sum, row) => sum + row[key], 0);
  const money = (key: 'revenueCents' | 'providerSpendCents' | 'marginCents') => rows.reduce<number | null>((sum, row) => sum === null || row[key] === null ? null : sum + row[key], 0);
  return { booksCreated: count('booksCreated'), paidFinishes: count('paidFinishes'), subscriptionFinishes: count('subscriptionFinishes'), complimentaryFinishes: count('complimentaryFinishes'), printedCopies: count('printedCopies'), revenueCents: money('revenueCents'), providerSpendCents: money('providerSpendCents'), marginCents: money('marginCents') };
}

export function storeSummary(store: 'apple' | 'amazon', rows: StoreDay[], expectedDates: string[]): BusinessStore {
  const timeseries = rows.filter(row => expectedDates.includes(row.date) && row.reportAvailable !== false)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(timeseries.map(row => row.date)).size !== timeseries.length || timeseries.some(row => !Number.isSafeInteger(row.downloads))) throw new Error('Invalid store dates or counts');
  const complete = expectedDates.every(date => timeseries.some(row => row.date === date));
  return { store, available: timeseries.length > 0, timeseries,
    downloads: timeseries.length ? timeseries.reduce((sum, row) => sum + row.downloads, 0) : null,
    latest: timeseries.at(-1) ?? null, complete,
    reportingTimezone: store === 'apple' ? 'America/Los_Angeles' : 'UTC',
    recordedSince: null, recordedDownloads: null };
}

/** Additive tables, only initialized by authenticated collection.
 * No business/customer rows are copied; these contain aggregate reports only. */
export async function ensureBusinessStorage() {
  if (!process.env.DATABASE_URL) throw new Error('History storage is not configured');
  const db = neon(process.env.DATABASE_URL);
  await db`CREATE TABLE IF NOT EXISTS business_metric_snapshots (
    key TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await db`CREATE TABLE IF NOT EXISTS store_download_days (
    project TEXT NOT NULL, store TEXT NOT NULL, date DATE NOT NULL,
    downloads INTEGER NOT NULL, updates INTEGER, redownloads INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(project, store, date)
  )`;
  // Add provenance without deleting the earlier, misattributed Fable/Amazon observations.
  await db`ALTER TABLE store_download_days ADD COLUMN IF NOT EXISTS source TEXT`;
}

async function archiveStore(project: string, store: BusinessStore) {
  if (!process.env.DATABASE_URL) return;
  const db = neon(process.env.DATABASE_URL);
  const source = storeSource(project, store.store);
  store.source = source;
  // One SQL statement per report; reruns replace observations, never add them.
  if (store.timeseries.length) await db`INSERT INTO store_download_days (project, store, date, downloads, updates, redownloads, source)
    SELECT ${project}, ${store.store}, (r->>'date')::date, (r->>'downloads')::integer,
      (r->>'updates')::integer, (r->>'redownloads')::integer, ${source}
    FROM jsonb_array_elements(${JSON.stringify(store.timeseries)}::jsonb) r
    ON CONFLICT (project, store, date) DO UPDATE SET downloads=EXCLUDED.downloads,
      updates=EXCLUDED.updates, redownloads=EXCLUDED.redownloads, source=EXCLUDED.source, updated_at=now()`;
  const [history] = await db`SELECT min(date)::text AS since, sum(downloads)::integer AS downloads
    FROM store_download_days WHERE project=${project} AND store=${store.store}
      AND (source=${source} OR (source IS NULL AND ${trustedLegacyStore(project, store.store)}))`;
  store.recordedSince = history?.since ?? null;
  store.recordedDownloads = history?.downloads ?? null;
}

/** Old cached snapshots must not bypass corrected account attribution. */
export function validateCachedStoreSources(report: BusinessSummary): BusinessSummary {
  return { ...report, apps: report.apps.map(app => ({ ...app, stores: app.stores.map(store => {
    if (store.source === storeSource(app.project, store.store) || (!store.source && trustedLegacyStore(app.project, store.store))) return store;
    return { ...store, available: false, timeseries: [], downloads: null, latest: null, complete: false,
      recordedSince: null, recordedDownloads: null,
      reason: 'The earlier report used a different developer account. A report from this app’s account is required.' };
  }) })) };
}

export async function cachedBusiness(days: number): Promise<BusinessSummary | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const db = neon(process.env.DATABASE_URL);
    const [row] = await db`SELECT payload FROM business_metric_snapshots WHERE key=${`business:${days}`}`;
    return row?.payload ? validateCachedStoreSources(row.payload as BusinessSummary) : null;
  } catch { return null; }
}

/** Validate the shared contract before a malformed report can become household data. */
export function validBusinessReport(data: unknown, expectedDays: number): data is {
  version: number; generatedAt: string; timeseries: BusinessDay[]; definitions: Record<string, string>; caveats: string[];
} {
  if (!data || typeof data !== 'object') return false;
  const report = data as Record<string, unknown>;
  if (report.version !== 1 || typeof report.generatedAt !== 'string' || !Number.isFinite(Date.parse(report.generatedAt))) return false;
  if (!Array.isArray(report.timeseries) || report.timeseries.length !== expectedDays) return false;
  const dates = new Set<string>();
  for (const row of report.timeseries) {
    if (!row || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || dates.has(row.date)) return false;
    dates.add(row.date);
    for (const key of ['booksCreated', 'paidFinishes', 'subscriptionFinishes', 'complimentaryFinishes', 'printedCopies']) if (!Number.isSafeInteger(row[key]) || row[key] < 0) return false;
    for (const key of ['revenueCents', 'providerSpendCents', 'marginCents']) if (row[key] !== null && !Number.isSafeInteger(row[key])) return false;
  }
  return !!report.definitions && typeof report.definitions === 'object' && Object.values(report.definitions).every(value => typeof value === 'string')
    && Array.isArray(report.caveats) && report.caveats.every(value => typeof value === 'string');
}

export async function collectBusiness(days: number, archive = false): Promise<BusinessSummary> {
  const through = dayAt(0), from = dayAt(1 - days);
  const result: BusinessSummary = { version: 1, generatedAt: new Date().toISOString(), range: { from, through, timezone: 'UTC' }, fable: null, apps: [] };
  const dates = Array.from({ length: days }, (_, i) => dayAt(i - days)); // completed store days
  const fableRequest = (async () => {
    try {
      const secret = process.env.BUSINESS_METRICS_TOKEN;
      if (!secret || secret.length < 32) throw new Error('Connection is not configured');
      const origin = process.env.FABLE_BUSINESS_ORIGIN || 'https://fabledesigner.com';
      if (!/^https:\/\//.test(origin)) throw new Error('Expected a secure Fable origin');
      const response = await fetch(`${origin}/api/business-metrics?from=${dayAt(1 - 2 * days)}&to=${through}`, {
        headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(60000), redirect: 'error',
      });
      if (!response.ok) throw new Error(`Fable returned ${response.status}`);
      const data = await response.json();
      if (!validBusinessReport(data, days * 2)) throw new Error('Unrecognized Fable report');
      const current: BusinessDay[] = data.timeseries.filter((row: BusinessDay) => row.date >= from && row.date <= through);
      const previous: BusinessDay[] = data.timeseries.filter((row: BusinessDay) => row.date < from);
      if (current.length !== days || previous.length !== days) throw new Error('Incomplete Fable date range');
      result.fable = { generatedAt: data.generatedAt, totals: summarizeBusinessDays(current), previous: summarizeBusinessDays(previous), timeseries: current, definitions: data.definitions, caveats: data.caveats };
    } catch { result.fableReason = 'Fable business figures are unavailable. Check the connection in Fable admin.'; }
  })();
  result.apps = await Promise.all(Object.entries(STORE_APPS).map(async ([project, app]) => {
    const reports = await Promise.allSettled([loadAppStore(project, `${days}d`), loadAmazonAppstore(project, `${days}d`)]);
    const stores = await Promise.all(reports.map(async (report, index) => {
      const store = index === 0 ? 'apple' : 'amazon';
      const downloads = report.status === 'fulfilled' && 'downloads' in report.value ? report.value.downloads : null;
      const summary = storeSummary(store, downloads?.available && "timeseries" in downloads ? downloads.timeseries : [], dates);
      summary.source = storeSource(project, store);
      if (!summary.available) summary.reason = report.status === 'fulfilled' && 'connectionReason' in report.value && report.value.connectionReason
        ? report.value.connectionReason : 'No store report is available for this period.';
      if (archive) { try { await archiveStore(project, summary); } catch { summary.reason = summary.available ? 'Live report received; history could not be saved.' : 'No current store report is available; history could not be loaded.'; } }
      return summary;
    }));
    return { project, name: app.name, stores };
  }));
  await fableRequest;
  if (archive && process.env.DATABASE_URL) {
    const db = neon(process.env.DATABASE_URL);
    // A failed Fable source cannot erase its last successful household snapshot.
    if (result.fable) {
      await db`INSERT INTO business_metric_snapshots (key,payload) VALUES (${`business:${days}`},${JSON.stringify(result)}::jsonb)
        ON CONFLICT (key) DO UPDATE SET payload=EXCLUDED.payload, updated_at=now()`;
    }
  }
  return result;
}
