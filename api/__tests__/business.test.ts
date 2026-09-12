import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { businessAccess, sessionCookie, verifyTicket } from '../_shared/business-access';
import { storeSummary, summarizeBusinessDays, validBusinessReport } from '../_shared/business-data';
import { appleCredentials, mapBounded, STORE_APPS } from '../_shared/store-apps';
import type { BusinessDay } from '../../src/types/business';
const secret = 'private-test-business-read-token-123456789';
const ticket = (purpose: string, exp: number) => {
  const payload = Buffer.from(JSON.stringify({ purpose, exp })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
};
const day: BusinessDay = { date: '2026-09-11', booksCreated: 2, paidFinishes: 1, subscriptionFinishes: 0, complimentaryFinishes: 1, printedCopies: 3, revenueCents: 999, providerSpendCents: null, marginCents: null };
afterEach(() => vi.unstubAllEnvs());
describe('private business connection', () => {
  it('validates the owner handoff signature, expiry and purpose', () => {
    const now = Date.now();
    const valid = ticket('business-handoff', Math.floor(now / 1000) + 300);
    expect(verifyTicket(valid, 'business-handoff', secret, now)).toBe(true);
    expect(verifyTicket(valid, 'business-session', secret, now)).toBe(false);
    expect(verifyTicket(valid, 'business-handoff', secret, now + 301000)).toBe(false);
    expect(verifyTicket(valid + 'broken', 'business-handoff', secret, now)).toBe(false);
    expect(verifyTicket(valid, 'business-handoff', 'wrong', now)).toBe(false);
  });
  it('allows a scoped bearer or secure signed session, never an arbitrary cookie', () => {
    const request = (headers: Record<string, string>) => ({ headers }) as VercelRequest;
    expect(businessAccess(request({ authorization: `Bearer ${secret}` }), secret)).toBe(true);
    expect(businessAccess(request({ cookie: sessionCookie(secret).split(';')[0] }), secret)).toBe(true);
    expect(businessAccess(request({ cookie: 'business_session=owner' }), secret)).toBe(false);
    expect(businessAccess(request({}), '')).toBe(false);
    expect(sessionCookie(secret)).toContain('HttpOnly; Secure; SameSite=Lax');
    expect(sessionCookie(secret)).not.toContain(secret);
  });
});
describe('honest aggregate reporting', () => {
  it('propagates unavailable money and does not include customer identifiers', () => {
    expect(summarizeBusinessDays([day, { ...day, revenueCents: null }])).toEqual({ booksCreated: 4, paidFinishes: 2, subscriptionFinishes: 0, complimentaryFinishes: 2, printedCopies: 6, revenueCents: null, providerSpendCents: null, marginCents: null });
  });
  it('keeps missing store days out of totals and marks the period incomplete', () => {
    const report = storeSummary('apple', [{ date: '2026-09-10', downloads: 3 }, { date: '2026-09-11', downloads: 0, reportAvailable: false }], ['2026-09-10', '2026-09-11']);
    expect(report.downloads).toBe(3);
    expect(report.latest?.date).toBe('2026-09-10');
    expect(report.complete).toBe(false);
    expect(storeSummary('amazon', [], ['2026-09-11']).downloads).toBeNull();
    expect(() => storeSummary('apple', [{ date: '2026-09-11', downloads: NaN }], ['2026-09-11'])).toThrow();
  });
  it('rejects partial, duplicated or malformed business days', () => {
    const report = { version: 1, generatedAt: new Date().toISOString(), timeseries: [day], definitions: {}, caveats: [] };
    expect(validBusinessReport(report, 1)).toBe(true);
    expect(validBusinessReport(report, 2)).toBe(false);
    expect(validBusinessReport({ ...report, timeseries: [day, day] }, 2)).toBe(false);
    expect(validBusinessReport({ ...report, timeseries: [{ ...day, revenueCents: undefined }] }, 1)).toBe(false);
  });
  it('uses distinct explicit identifiers and bounds report concurrency', async () => {
    expect(new Set(Object.values(STORE_APPS).map(app => app.asin)).size).toBe(2);
    let active = 0, peak = 0;
    const result = await mapBounded([1, 2, 3, 4, 5], async value => { active++; peak = Math.max(active, peak); await new Promise(resolve => setTimeout(resolve, 5)); active--; return value * 2; }, 2);
    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});

it('does not reuse the personal Apple team credentials for Fable Designer LLC', () => {
  const env = { ASC_KEY_ID: 'personal-key', FABLE_ASC_KEY_ID: 'llc-key', ASC_VENDOR_NUMBER: 'personal-vendor' };
  expect(appleCredentials('space-race', env).keyId).toBe('personal-key');
  expect(appleCredentials('fable-designer', env).keyId).toBe('llc-key');
  expect(appleCredentials('fable-designer', env).vendorNumber).toBeUndefined();
});
