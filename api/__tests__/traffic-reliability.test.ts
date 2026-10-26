import { beforeEach, expect, it, vi } from 'vitest';
const { runReport, properties } = vi.hoisted(() => ({ runReport: vi.fn(), properties: { good: '1', failed: '2', missing: '', 'animal-penpals': '1' } }));
vi.mock('../_shared/ga4.js', async (importOriginal) => ({ ...await importOriginal<object>(), GA4_PROPERTIES: properties, getGa4Client: () => ({ runReport }) }));
import overview from '../traffic-overview';
import detail from '../ga-traffic';
const response = () => ({ setHeader: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnThis() });
const metrics = (users: number) => [20, 10, users, 2, 0.5, 30, 0.5].map(value => ({ value: String(value) }));
beforeEach(() => {
  vi.clearAllMocks();
  runReport.mockImplementation(async (request) => {
    if (request.property === 'properties/2') throw new Error('Permission denied');
    if (request.dimensions?.[0]?.name === 'date') return [{ rows: [1, 2].map(day => ({ dimensionValues: [{ value: `2026100${day}` }], metricValues: metrics(8) })) }];
    if (request.dimensions) return [{ rows: [] }];
    return [{ rows: [{ metricValues: metrics(9) }] }];
  });
});
it('uses deduplicated period totals in detail instead of summing daily users', async () => {
  const res = response();
  await detail({ query: { project: 'good', range: '30d' } } as never, res as never);
  expect(res.json.mock.calls[0][0].totals.users).toBe(9);
});
it('reports missing and failed GA sources visibly', async () => {
  const res = response();
  await overview({ query: { range: '30d' } } as never, res as never);
  expect(res.json.mock.calls[0][0].unavailable).toEqual(expect.arrayContaining([
    { project: 'missing', reason: 'No GA4 property configured' },
    { project: 'failed', reason: 'Traffic query failed' },
  ]));
});
it('never substitutes another project property for an unconfigured project', async () => {
  const res = response();
  await detail({ query: { project: 'missing' } } as never, res as never);
  expect(res.status.mock.calls[0][0]).toBe(400);
  expect(res.json.mock.calls[0][0]).toEqual({ error: 'No GA4 property configured for project: missing' });
});

import { trafficWindow } from '../_shared/traffic';
it('aligns calendar dates to the property timezone, including near UTC midnight', () => {
  const now = Date.parse('2026-10-26T01:30:00Z'); // Still Oct 25 in New York.
  expect(trafficWindow(7, 'good', false, now).dateRanges).toEqual([{ startDate: '2026-10-19', endDate: '2026-10-25' }]);
  expect(trafficWindow(7, 'good', true, now).dateRanges).toEqual([{ startDate: '2026-10-12', endDate: '2026-10-18' }]);
});
it('uses 24 completed hours with an adjacent prior period', () => {
  const now = Date.parse('2026-10-26T16:30:00Z');
  const current = trafficWindow(1, 'good', false, now).dimensionFilter?.filter.inListFilter.values;
  const prior = trafficWindow(1, 'good', true, now).dimensionFilter?.filter.inListFilter.values;
  expect(current).toHaveLength(24);
  expect([current?.[0], current?.at(-1), prior?.at(-1)]).toEqual(['2026102512', '2026102611', '2026102511']);
});
it('uses aggregate users for hourly detail and overview and keeps identical query windows', async () => {
  const d = response();
  const o = response();
  await detail({ query: { project: 'good', range: '1d' } } as never, d as never);
  await overview({ query: { range: '1d' } } as never, o as never);
  expect(d.json.mock.calls[0][0].totals.users).toBe(9);
  expect(o.json.mock.calls[0][0].projects.find((p: { project: string }) => p.project === 'good').current.users).toBe(9);
  const requests = runReport.mock.calls.map(([request]) => request);
  expect(requests.slice(0, 4).map(r => r.dimensionFilter)).toEqual(Array(4).fill(requests[0].dimensionFilter));
});
it('keeps successful current data but marks a failed comparison unavailable', async () => {
  runReport.mockImplementation(async request => {
    if (request.dateRanges[0].endDate < '2026-10-25') throw new Error('Historical report failed');
    return [{ rows: [{ metricValues: metrics(9) }] }];
  });
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-26T16:30:00Z'));
  const res = response();
  await overview({ query: { range: '7d' } } as never, res as never);
  expect(res.json.mock.calls[0][0]).toMatchObject({ comparisonUnavailable: expect.arrayContaining(['good']), projects: expect.arrayContaining([{ project: 'good', current: expect.objectContaining({ users: 9 }), previous: null, usersChangePct: null, pageviewsChangePct: null }]) });
  vi.restoreAllMocks();
});
