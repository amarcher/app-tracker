import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../crossword-gameplay';
import { sessionCookie } from '../_shared/business-access';
const source = vi.hoisted(() => ({ loadCrosswordGameplay: vi.fn() }));
vi.mock('../_shared/crossword-gameplay.js', () => source);
const secret = 'private-gameplay-report-fixture-123456789';
const response = () => {
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res); return res;
};
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('BUSINESS_METRICS_TOKEN', secret); });
afterEach(() => vi.unstubAllEnvs());

it('rejects anonymous requests before any source access, with private no-store responses', async () => {
  const res = response();
  await handler({ query: {}, headers: {}, method: 'GET' } as VercelRequest, res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(source.loadCrosswordGameplay).not.toHaveBeenCalled();
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
});

it('accepts the existing business session cookie without exposing a token to JavaScript', async () => {
  const report = { available: true, segments: {} }; source.loadCrosswordGameplay.mockResolvedValue(report);
  const res = response();
  await handler({ query: { range: '30d' }, headers: { cookie: sessionCookie(secret).split(';')[0] }, method: 'GET' } as VercelRequest, res as unknown as VercelResponse);
  expect(source.loadCrosswordGameplay).toHaveBeenCalledWith(30);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(report);
});

it('bounds ranges and refuses write methods', async () => {
  for (const [method, range, code] of [['POST', '7d', 405], ['GET', '900d', 400], ['GET', '7', 400]]) {
    const res = response();
    await handler({ query: { range }, headers: { authorization: `Bearer ${secret}` }, method } as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenCalledWith(code);
  }
  expect(source.loadCrosswordGameplay).not.toHaveBeenCalled();
});

it('distinguishes a failed connection from a successful zero report', async () => {
  source.loadCrosswordGameplay.mockResolvedValue({ available: false, reason: 'Unavailable' });
  const res = response();
  await handler({ query: {}, headers: { authorization: `Bearer ${secret}` }, method: 'GET' } as VercelRequest, res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(503);
});
