import { afterEach, expect, it, vi } from 'vitest';
import { ENTITLEMENT_SELECT, EVENT_SELECT, inForce, loadCrosswordPlus, planOf, plusCredentials, storeOf, summarizePlus } from '../_shared/crossword-plus';
import type { EntitlementRow, PurchaseEventRow } from '../_shared/crossword-plus';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const NOW = Date.parse('2026-11-04T12:00:00Z');
const DAY = 86400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const row = (user_id: string, over: Partial<EntitlementRow> = {}): EntitlementRow =>
  ({ user_id, source: 'revenuecat', status: 'active', expires_at: at(-20), will_renew: true, ...over });
const rc = (user_id: string, kind: string, daysAgo: number, over: Partial<PurchaseEventRow> = {}): PurchaseEventRow =>
  ({ source: 'revenuecat', user_id, kind, received_at: at(daysAgo), product: 'plus_monthly', store: 'APP_STORE', environment: 'PRODUCTION', ...over });
const stripe = (user_id: string, kind: string, daysAgo: number, over: Partial<PurchaseEventRow> = {}): PurchaseEventRow =>
  ({ source: 'stripe', user_id, kind, received_at: at(daysAgo), lookup: 'crossword-clash-plus-monthly', interval: 'month', livemode: 'true', ...over });

it('names the plan by the same rule as the purchase alert', () => {
  expect(planOf('plus_monthly')).toBe('monthly');
  expect(planOf('plus_annual')).toBe('annual');
  expect(planOf('plus_annual:annual')).toBe('annual'); // Play's base plan suffix
  expect(planOf('crossword-clash-plus-monthly')).toBe('monthly');
  expect(planOf('crossword-clash-plus-annual')).toBe('annual');
  expect(planOf('price_9', 'year')).toBe('annual');
  expect(planOf(null, 'month')).toBe('monthly');
  expect(planOf('plus_lifetime')).toBe('unknown');
  expect(storeOf('revenuecat', 'APP_STORE')).toBe('appStore');
  expect(storeOf('revenuecat', 'PLAY_STORE')).toBe('googlePlay');
  expect(storeOf('revenuecat', 'PROMOTIONAL')).toBe('other');
  expect(storeOf('stripe', null)).toBe('web');
});

it('counts only unexpired active or grace rows as in force', () => {
  expect(inForce(row('a'), NOW)).toBe(true);
  expect(inForce(row('a', { status: 'grace' }), NOW)).toBe(true);
  expect(inForce(row('a', { expires_at: null }), NOW)).toBe(true);
  expect(inForce(row('a', { expires_at: at(1) }), NOW)).toBe(false);
  expect(inForce(row('a', { status: 'expired', expires_at: at(-5) }), NOW)).toBe(false);
  expect(inForce(row('a', { status: 'revoked' }), NOW)).toBe(false);
});

it('splits subscribers by store and plan, prices the month, and keeps sandbox and test mode apart', () => {
  const entitlements = [
    row('ios-monthly'), row('ios-annual', { will_renew: false }), row('play-annual'), row('web-monthly', { source: 'stripe' }),
    row('lapsed', { status: 'expired', expires_at: at(3) }), row('review', { expires_at: at(-0.5) }), row('web-test', { source: 'stripe' }),
    row('press', { source: 'grant', expires_at: null }), row('no-events'),
  ];
  const events = [
    rc('ios-monthly', 'INITIAL_PURCHASE', 2), rc('ios-monthly', 'TEST', 1, { product: null, store: null }),
    rc('ios-annual', 'INITIAL_PURCHASE', 40, { product: 'plus_annual' }), rc('ios-annual', 'CANCELLATION', 3, { product: 'plus_annual' }),
    rc('play-annual', 'INITIAL_PURCHASE', 10, { product: 'plus_annual:annual', store: 'PLAY_STORE' }),
    stripe('web-monthly', 'checkout.session.completed', 5, { lookup: null, interval: null }), stripe('web-monthly', 'customer.subscription.created', 5),
    rc('lapsed', 'INITIAL_PURCHASE', 33), rc('lapsed', 'EXPIRATION', 3),
    rc('review', 'INITIAL_PURCHASE', 1, { environment: 'SANDBOX' }),
    stripe('web-test', 'customer.subscription.created', 7, { livemode: 'false' }),
  ];
  const plus = summarizePlus(entitlements, events, NOW);
  expect(plus).toMatchObject({ available: true, active: 5, cancelling: 1, grants: 1, newLast7Days: 2, newLast30Days: 3 });
  expect(plus.byStore).toEqual({ appStore: 2, googlePlay: 1, web: 1, other: 1 });
  expect(plus.byPlan).toEqual({ monthly: 2, annual: 2, unknown: 1 });
  expect(plus.mrrCents).toBe(Math.round(2 * 399 + 2 * 2499 / 12)); // 1215: the unknown plan is not priced
  expect(plus.test).toEqual({ active: 2, newLast30Days: 2 });
});

it('takes the plan from the latest event that names one', () => {
  const plus = summarizePlus([row('u')], [rc('u', 'INITIAL_PURCHASE', 60), rc('u', 'RENEWAL', 20, { product: 'plus_annual' }), rc('u', 'TRANSFER', 1, { product: null })], NOW);
  expect(plus.byPlan).toEqual({ monthly: 0, annual: 1, unknown: 0 });
  expect(summarizePlus([], [], NOW)).toMatchObject({ available: true, active: 0, mrrCents: 0 });
});

it('waits for the service key without calling Supabase', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(plusCredentials({})).toEqual({ url: 'https://rdqdhawlxuclfxpsvdgs.supabase.co', key: undefined });
  const plus = await loadCrosswordPlus(NOW, {});
  expect(plus).toMatchObject({ available: false, reason: 'Crossword Clash Plus is awaiting its Supabase connection.', active: 0 });
  expect(fetcher).not.toHaveBeenCalled();
});

it('reads both tables through PostgREST with only the plan-naming fields of each payload, paging past the row cap', async () => {
  const seen: { url: URL; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: { headers: Record<string, string> }) => {
    const url = new URL(input); seen.push({ url, headers: init.headers });
    const offset = Number(url.searchParams.get('offset'));
    if (url.pathname === '/rest/v1/entitlements') return Response.json(offset ? [] : [row('u'), row('v', { source: 'stripe' })]);
    if (url.pathname === '/rest/v1/purchase_events') return Response.json(offset === 0 ? Array.from({ length: 1000 }, () => rc('u', 'RENEWAL', 2))
      : [rc('u', 'INITIAL_PURCHASE', 3), stripe('v', 'customer.subscription.created', 1, { lookup: 'crossword-clash-plus-annual', interval: 'year' })]);
    throw new Error(`unexpected ${url.pathname}`);
  }));
  const plus = await loadCrosswordPlus(NOW, { CROSSWORD_CLASH_SUPABASE_SERVICE_KEY: 'service-role-fixture' });
  expect(plus).toMatchObject({ available: true, active: 2, newLast7Days: 2, mrrCents: 399 + Math.round(2499 / 12) });
  expect(plus.byStore).toEqual({ appStore: 1, googlePlay: 0, web: 1, other: 0 });
  expect(seen.map(s => s.url.pathname + '?offset=' + s.url.searchParams.get('offset')).sort()).toEqual(
    ['/rest/v1/entitlements?offset=0', '/rest/v1/purchase_events?offset=0', '/rest/v1/purchase_events?offset=1000']);
  expect(seen.every(s => s.headers.apikey === 'service-role-fixture' && s.headers.Authorization === 'Bearer service-role-fixture')).toBe(true);
  const events = seen.find(s => s.url.pathname === '/rest/v1/purchase_events')!.url;
  expect(events.searchParams.get('select')).toBe(EVENT_SELECT);
  expect(EVENT_SELECT).not.toContain('payload,');
  expect(EVENT_SELECT).toContain('lookup:payload->data->object->items->data->0->price->>lookup_key');
  expect(seen.find(s => s.url.pathname === '/rest/v1/entitlements')!.url.searchParams.get('select')).toBe(ENTITLEMENT_SELECT);
});

it('never surfaces a Supabase error body and leaves the other household rows alone', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"JWT secret-looking-detail"}', { status: 401 })));
  const refused = await loadCrosswordPlus(NOW, { CROSSWORD_CLASH_SUPABASE_SERVICE_KEY: 'k' });
  expect(refused).toMatchObject({ available: false, reason: 'Supabase refused the Crossword Clash connection. Check the service key.' });
  expect(JSON.stringify(refused)).not.toContain('secret-looking');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET https://user:pass@host')));
  const down = await loadCrosswordPlus(NOW, { CROSSWORD_CLASH_SUPABASE_SERVICE_KEY: 'k' });
  expect(down).toMatchObject({ available: false, reason: 'Crossword Clash Plus figures are unavailable right now.' });
  expect(JSON.stringify(down)).not.toContain('pass@host');
  expect((await loadCrosswordPlus(NOW, { CROSSWORD_CLASH_SUPABASE_SERVICE_KEY: 'k', CROSSWORD_CLASH_SUPABASE_URL: 'http://insecure.test' })).available).toBe(false);
});
