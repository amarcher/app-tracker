import { beforeEach, expect, it, vi } from 'vitest';
const { sql } = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: () => sql }));
import portfolio from '../portfolio-summary';
import usage from '../api-usage';
const row = { project: 'crossword-clash', service: 'openai', model: 'gpt-4o-mini', tokens_in: '1000000', tokens_out: '1000000', characters: '0', requests: '2' };
const response = () => ({ setHeader: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnThis() });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('DATABASE_URL', 'unused-test-url'); });
it('includes OpenAI in portfolio at the same rate as project usage', async () => {
  sql.mockResolvedValueOnce([row]);
  const p = response();
  await portfolio({ query: {} } as never, p as never);
  expect(p.json.mock.calls[0][0].projects[0].estimatedCost).toBe(0.75);
  sql.mockResolvedValueOnce([]).mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
  const u = response();
  await usage({ query: {} } as never, u as never);
  expect(u.json.mock.calls[0][0].totalCost).toBe(0.75);
});
it('counts unknown models and plan-dependent voice usage as unpriced', async () => {
  sql.mockResolvedValueOnce([{ ...row, model: 'future-model' }, { ...row, service: 'elevenlabs', model: null, characters: '1000' }]);
  const p = response();
  await portfolio({ query: {} } as never, p as never);
  expect(p.json.mock.calls[0][0].projects[0]).toMatchObject({ estimatedCost: 0, unpricedRequests: 4 });
});

import { estimateCost } from '../_shared/usage-pricing';
it('uses verified Haiku and Opus rates and does not guess unknown model prices', () => {
  expect(estimateCost('anthropic', 'claude-haiku-4-5-20251001', 1_000_000, 1_000_000)).toBe(6);
  expect(estimateCost('anthropic', 'claude-opus-4-7', 1_000_000, 1_000_000)).toBe(30);
  expect(estimateCost('openai', 'future-model', 100, 100)).toBeNull();
  expect(estimateCost('openai', null, 100, 100)).toBeNull();
  expect(estimateCost('elevenlabs', null, 100, 100)).toBeNull();
  expect(estimateCost('openai', 'gpt-4o-mini', -1, 100)).toBeNull();
});
it('keeps priced subtotals while reporting excluded models in project usage', async () => {
  sql.mockResolvedValueOnce([]).mockResolvedValueOnce([row, { ...row, model: 'future-model', requests: '3' }]).mockResolvedValueOnce([]);
  const res = response();
  await usage({ query: {} } as never, res as never);
  expect(res.json.mock.calls[0][0]).toMatchObject({ totalCost: 0.75, unpricedRequests: 3, totals: [{ service: 'openai', requests: 5, unpricedRequests: 3, estimatedCost: 0.75 }], unpricedUsage: [{ service: 'openai', model: 'future-model', requests: 3 }] });
});
it('does not price inherited object keys as models', () => {
  expect(estimateCost('openai', 'toString', 100, 100)).toBeNull();
  expect(estimateCost('constructor', 'gpt-4o-mini', 100, 100)).toBeNull();
});
it('prices the observed Opus 5.5 model consistently in portfolio and detail', async () => {
  const opus = { ...row, service: 'anthropic', model: 'claude-opus-5-5' };
  sql.mockResolvedValueOnce([opus]);
  const p = response();
  await portfolio({ query: {} } as never, p as never);
  expect(p.json.mock.calls[0][0].projects[0]).toMatchObject({ estimatedCost: 24, unpricedRequests: 0 });
  sql.mockResolvedValueOnce([]).mockResolvedValueOnce([opus]).mockResolvedValueOnce([]);
  const u = response();
  await usage({ query: {} } as never, u as never);
  expect(u.json.mock.calls[0][0]).toMatchObject({ totalCost: 24, unpricedRequests: 0, unpricedUsage: [] });
});
