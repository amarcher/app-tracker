import type { PlusPlan, PlusStore, PlusSummary } from '../../src/types/business.js';

/** Public project identity; the key lives in `CROSSWORD_CLASH_SUPABASE_SERVICE_KEY` (service role: both tables are
 * RLS-locked with no client policies, so nothing weaker can read them). The same project serves the live site. */
export const CROSSWORD_CLASH_SUPABASE = { projectRef: 'rdqdhawlxuclfxpsvdgs', name: 'Crossword Clash Plus' } as const;
/** List prices in `src/lib/plus.ts` of the crossword-clash repo: $3.99 a month, $24.99 a year. */
export const PLUS_PRICE_CENTS = { monthly: 399, annual: 2499 } as const;
const PAGE = 1000; // Supabase's PostgREST max-rows default
const DAY = 86400_000;

export function plusCredentials(env = process.env) {
  const url = env.CROSSWORD_CLASH_SUPABASE_URL || `https://${CROSSWORD_CLASH_SUPABASE.projectRef}.supabase.co`;
  return { url, key: env.CROSSWORD_CLASH_SUPABASE_SERVICE_KEY };
}

/** The rule of `planName()` in crossword-clash's `src/lib/purchaseAlert.ts`: RevenueCat product ids
 * (`plus_monthly`, `plus_annual`, Play's `plus_annual:annual`) and Stripe lookup keys
 * (`crossword-clash-plus-monthly` / `-annual`) name the plan; a Stripe price interval decides when the key does not. */
export function planOf(productId: string | null | undefined, interval?: string | null): PlusPlan {
  const id = (productId ?? '').toLowerCase();
  if (id.includes('annual') || id.includes('yearly') || interval === 'year') return 'annual';
  if (id.includes('monthly') || interval === 'month') return 'monthly';
  return 'unknown';
}

/** RevenueCat's `store` → where the money comes from. A Stripe entitlement is the web checkout. */
export function storeOf(source: string, store: string | null | undefined): PlusStore {
  if (source === 'stripe') return 'web';
  if (source === 'apple') return 'appStore';
  if (source === 'google') return 'googlePlay';
  switch ((store ?? '').toUpperCase()) {
    case 'APP_STORE': case 'MAC_APP_STORE': return 'appStore';
    case 'PLAY_STORE': return 'googlePlay';
    default: return 'other';
  }
}

/** An `entitlements` row as the dashboard reads it. */
export type EntitlementRow = { user_id: string; source: string; status: string; expires_at: string | null; will_renew: boolean };
/** A `purchase_events` row with the plan-naming fields projected out of its payload (see `EVENT_SELECT`). */
export type PurchaseEventRow = {
  source: string; user_id: string | null; kind: string; received_at: string;
  product?: string | null; store?: string | null; environment?: string | null;
  lookup?: string | null; interval?: string | null; livemode?: string | boolean | null;
};

/** In force: paid up or in the store's billing-retry window, and not past its expiry (null = lifetime). */
export const inForce = (row: EntitlementRow, now: number) =>
  (row.status === 'active' || row.status === 'grace') && (row.expires_at === null || Date.parse(row.expires_at) > now);

/** A first purchase, as the store names it. Renewals, restores and transfers are not new subscribers. */
const isFirstPurchase = (event: PurchaseEventRow) =>
  (event.source === 'revenuecat' && event.kind === 'INITIAL_PURCHASE') || (event.source === 'stripe' && event.kind === 'customer.subscription.created');
/** Sandbox (App Review, TestFlight testers) and Stripe test mode never count as real. */
const isTest = (event: PurchaseEventRow) =>
  event.source === 'revenuecat' ? (event.environment ?? '').toUpperCase() === 'SANDBOX' : event.source === 'stripe' ? String(event.livemode) !== 'true' : false;
const namesPlan = (event: PurchaseEventRow) => !!(event.product || event.lookup || event.interval);

const emptyPlus = (): PlusSummary => ({ available: true, active: 0, byStore: { appStore: 0, googlePlay: 0, web: 0, other: 0 },
  byPlan: { monthly: 0, annual: 0, unknown: 0 }, cancelling: 0, newLast7Days: 0, newLast30Days: 0, mrrCents: 0, grants: 0,
  test: { active: 0, newLast30Days: 0 } });

/** Pure: the Plus figures from the two tables. Each subscriber's plan and store come from their latest event that
 * names a plan (the entitlement row carries neither); a subscriber whose latest such event is sandbox or test mode
 * is counted under `test`, apart from everything else. */
export function summarizePlus(entitlements: EntitlementRow[], events: PurchaseEventRow[], now = Date.now()): PlusSummary {
  const summary = emptyPlus();
  const latest = new Map<string, PurchaseEventRow>();
  for (const event of events) {
    if (!event.user_id || !namesPlan(event)) continue;
    const seen = latest.get(event.user_id);
    if (!seen || Date.parse(event.received_at) > Date.parse(seen.received_at)) latest.set(event.user_id, event);
  }
  for (const row of entitlements) {
    if (!inForce(row, now)) continue;
    if (row.source === 'grant') { summary.grants += 1; continue; }
    const event = latest.get(row.user_id);
    if (event && isTest(event)) { summary.test.active += 1; continue; }
    const plan = event ? planOf(event.source === 'stripe' ? event.lookup : event.product, event.interval) : 'unknown';
    summary.active += 1;
    summary.byPlan[plan] += 1;
    summary.byStore[storeOf(row.source, event?.store)] += 1;
    if (!row.will_renew) summary.cancelling += 1;
  }
  summary.mrrCents = Math.round(summary.byPlan.monthly * PLUS_PRICE_CENTS.monthly + summary.byPlan.annual * PLUS_PRICE_CENTS.annual / 12);
  for (const event of events) {
    if (!isFirstPurchase(event)) continue;
    const age = now - Date.parse(event.received_at);
    if (!(age >= 0 && age < 30 * DAY)) continue;
    if (isTest(event)) { summary.test.newLast30Days += 1; continue; }
    summary.newLast30Days += 1;
    if (age < 7 * DAY) summary.newLast7Days += 1;
  }
  return summary;
}

export const ENTITLEMENT_SELECT = 'user_id,source,status,expires_at,will_renew';
/** PostgREST projects the plan-naming fields out of the JSON payload, so no whole webhook body ever leaves the database:
 * RevenueCat rows hold the `{ event }` envelope, Stripe rows the event with its subscription under `data.object`. */
export const EVENT_SELECT = ['source', 'user_id', 'kind', 'received_at', 'product:payload->event->>product_id', 'store:payload->event->>store',
  'environment:payload->event->>environment', 'lookup:payload->data->object->items->data->0->price->>lookup_key',
  'interval:payload->data->object->items->data->0->price->recurring->>interval', 'livemode:payload->>livemode'].join(',');

async function readAll<T>(url: string, key: string, table: string, query: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const response = await fetch(`${url}/rest/v1/${table}?${query}&limit=${PAGE}&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    // Error bodies can quote the request; never surface them.
    if (response.status === 401 || response.status === 403) throw new Error('supabase_access');
    if (!response.ok) throw new Error('supabase_unavailable');
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('supabase_unavailable');
    rows.push(...(page as T[]));
    if (page.length < PAGE) return rows;
  }
}

/** Live Plus figures, or why they are missing. Never throws: the household snapshot must not lose its other rows. */
export async function loadCrosswordPlus(now = Date.now(), env = process.env): Promise<PlusSummary> {
  const { url, key } = plusCredentials(env);
  if (!key) return { ...emptyPlus(), available: false, reason: 'Crossword Clash Plus is awaiting its Supabase connection.' };
  try {
    if (!/^https:\/\//.test(url)) throw new Error('supabase_access');
    const [entitlements, events] = await Promise.all([
      readAll<EntitlementRow>(url, key, 'entitlements', `product=eq.plus&select=${ENTITLEMENT_SELECT}&order=user_id.asc`),
      readAll<PurchaseEventRow>(url, key, 'purchase_events', `select=${EVENT_SELECT}&order=received_at.desc`),
    ]);
    return summarizePlus(entitlements, events, now);
  } catch (error) {
    const reason = error instanceof Error && error.message === 'supabase_access'
      ? 'Supabase refused the Crossword Clash connection. Check the service key.' : 'Crossword Clash Plus figures are unavailable right now.';
    return { ...emptyPlus(), available: false, reason };
  }
}
