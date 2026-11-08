import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'node:crypto';
import handler from '../business';

const source = vi.hoisted(() => ({ cachedBusiness: vi.fn(), collectBusiness: vi.fn(), ensureBusinessStorage: vi.fn() }));
vi.mock('../_shared/business-data.js', () => source);
const gameplay = vi.hoisted(() => ({ loadCrosswordGameplay: vi.fn() }));
vi.mock('../_shared/crossword-gameplay.js', () => gameplay);
const secret = 'private-business-report-fixture-123456789';
const response = () => {
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn(), redirect: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('BUSINESS_METRICS_TOKEN', secret); vi.stubEnv('CRON_SECRET', ''); });
afterEach(() => vi.unstubAllEnvs());

it('rejects unauthenticated reads and syncs before touching any source or database', async () => {
  for (const action of [undefined, 'household', 'sync', 'gameplay']) {
    const res = response();
    await handler({ query: { action }, headers: {}, method: 'GET' } as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  }
  expect(source.cachedBusiness).not.toHaveBeenCalled();
  expect(source.collectBusiness).not.toHaveBeenCalled();
  expect(source.ensureBusinessStorage).not.toHaveBeenCalled();
  expect(gameplay.loadCrosswordGameplay).not.toHaveBeenCalled();
});

it('uses the Fable handoff session for both business and gameplay on the same endpoint', async () => {
  const payload = Buffer.from(JSON.stringify({ purpose: 'business-handoff', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
  const ticket = `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
  const signin = response();
  await handler({ query: { action: 'session' }, headers: {}, method: 'POST', body: new URLSearchParams({ ticket }).toString() } as VercelRequest, signin as unknown as VercelResponse);
  expect(signin.redirect).toHaveBeenCalledWith(303, '/?view=businesses');
  const cookie = signin.setHeader.mock.calls.find(call => call[0] === 'Set-Cookie')![1].split(';')[0];
  const cached = { generatedAt: new Date().toISOString(), apps: [] };
  source.cachedBusiness.mockResolvedValue(cached);
  const business = response();
  await handler({ query: { range: '7d' }, headers: { cookie }, method: 'GET' } as VercelRequest, business as unknown as VercelResponse);
  expect(business.json).toHaveBeenCalledWith(cached);
  vi.clearAllMocks();
  const report = { available: true, segments: {} };
  gameplay.loadCrosswordGameplay.mockResolvedValue(report);
  const res = response();
  await handler({ query: { action: 'gameplay', range: '7d' }, headers: { cookie }, method: 'GET' } as VercelRequest, res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(report);
  expect(source.cachedBusiness).not.toHaveBeenCalled();
  expect(source.collectBusiness).not.toHaveBeenCalled();
});

it('serves the household from a dated snapshot without running slow store queries', async () => {
  const cached = { version: 1, generatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), fable: { totals: { booksCreated: 3 } } };
  source.cachedBusiness.mockResolvedValue(cached);
  const res = response();
  await handler({ query: { action: 'household', range: '7d' }, headers: { authorization: `Bearer ${secret}` }, method: 'GET' } as VercelRequest, res as unknown as VercelResponse);
  expect(res.json).toHaveBeenCalledWith({ ...cached, stale: true });
  expect(source.collectBusiness).not.toHaveBeenCalled();
  expect(source.ensureBusinessStorage).not.toHaveBeenCalled();
});

it('does not manufacture an empty household snapshot when no report exists', async () => {
  source.cachedBusiness.mockResolvedValue(null);
  const res = response();
  await handler({ query: { action: 'household' }, headers: { authorization: `Bearer ${secret}` }, method: 'GET' } as VercelRequest, res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(source.collectBusiness).not.toHaveBeenCalled();
});
