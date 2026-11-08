/// <reference types="node" />
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CrosswordGameplay } from '../CrosswordGameplay';
import { summarizeGameplay } from '../../../api/_shared/crossword-gameplay';

vi.mock('recharts', () => ({ ResponsiveContainer: () => <div aria-label="Daily chart" />, Bar: () => null, BarChart: () => null, CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
const report = summarizeGameplay([{ id: 'v', user_id: 'u', started_at: '2026-11-04T00:00:00Z', client: 'ios', signed_in: true, mode: 'solo', completed: true, cells_filled: 25, cells_at_start: 0, wrong_letters: 0 }], [{ user_id: 'u', username: 'Solver' }], 7, Date.parse('2026-11-08T05:00:00Z'));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('shows a private sign-in prompt without player figures when unauthorized', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401 }));
  render(<CrosswordGameplay range="7d" refresh={0} />);
  expect(await screen.findByText('Your player activity is private')).toBeDefined();
  expect(screen.queryByText('Active players')).toBeNull();
  expect(screen.getByRole('link', { name: 'Open Fable admin' }).getAttribute('href')).toBe('https://fabledesigner.com/admin/business');
});

it('filters recorded gameplay and names together, while keeping platform totals explicit', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => report }));
  render(<CrosswordGameplay range="7d" refresh={0} />);
  expect(await screen.findByText('Solver')).toBeDefined();
  expect(screen.getByText('Active players', { selector: '.metric-label' }).nextElementSibling?.textContent).toBe('1');
  expect(screen.getByText(/Includes owner and test activity/)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Android' }));
  expect(screen.getByText('Active players', { selector: '.metric-label' }).nextElementSibling?.textContent).toBe('0');
  expect(screen.queryByText('Solver')).toBeNull();
  expect(screen.getByText('No attempts recorded')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'All platforms' }));
  expect(screen.getByText('Solver')).toBeDefined();
});

it('never renders connection failure as zero players', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ available: false, reason: 'Connection unavailable.' }) }));
  render(<CrosswordGameplay range="7d" refresh={0} />);
  expect(await screen.findByText('Connection unavailable.')).toBeDefined();
  expect(screen.queryByText('Active players')).toBeNull();
});

it('clears the old range immediately and ignores a superseded response', async () => {
  let resolveOld!: (value: unknown) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ available: false, reason: 'New range unavailable.' }) });
  vi.stubGlobal('fetch', fetcher);
  const { rerender } = render(<CrosswordGameplay range="7d" refresh={0} />);
  rerender(<CrosswordGameplay range="30d" refresh={0} />);
  expect(await screen.findByText('New range unavailable.')).toBeDefined();
  resolveOld({ ok: true, status: 200, json: async () => report });
  await Promise.resolve();
  expect(screen.queryByText('Solver')).toBeNull();
});
