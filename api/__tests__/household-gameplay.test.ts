import { afterEach, expect, it, vi } from 'vitest';
import { loadHouseholdGameplay } from '../_shared/household-gameplay';
import { loadCrosswordGameplay, summarizeGameplay } from '../_shared/crossword-gameplay';

vi.mock('../_shared/crossword-gameplay', async importOriginal => ({
  ...await importOriginal<typeof import('../_shared/crossword-gameplay')>(), loadCrosswordGameplay: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

it('uses yesterday across apps and web, projecting only counts and dates into the household snapshot', async () => {
  const now = Date.parse('2026-11-08T05:00:00Z');
  const row = { id: 'private-visit', user_id: 'private-user', started_at: '2026-11-07T23:59:59Z', client: 'ios', signed_in: true, mode: 'solo', completed: false, cells_filled: 1, cells_at_start: 0, wrong_letters: 0 };
  const report = summarizeGameplay([row, { ...row, id: 'second', client: 'web' },
    { ...row, id: 'today', started_at: '2026-11-08T00:00:00Z' }], [{ user_id: 'private-user', username: 'Private Name' }], 1, now);
  vi.mocked(loadCrosswordGameplay).mockResolvedValue(report);
  expect(await loadHouseholdGameplay(now)).toEqual({ available: true, generatedAt: '2026-11-08T05:00:00.000Z', date: '2026-11-07', players: 1, attempts: 2 });
  expect(loadCrosswordGameplay).toHaveBeenCalledWith(1, now);
});

it('distinguishes zero play from an unavailable source and isolates source failures', async () => {
  const now = Date.parse('2026-11-08T05:00:00Z');
  vi.mocked(loadCrosswordGameplay).mockResolvedValue(summarizeGameplay([], [], 1, now));
  expect(await loadHouseholdGameplay(now)).toMatchObject({ available: true, players: 0, attempts: 0 });
  vi.mocked(loadCrosswordGameplay).mockResolvedValue({ available: false, reason: 'private source failure' });
  expect(await loadHouseholdGameplay(now)).toEqual({ available: false });
  vi.mocked(loadCrosswordGameplay).mockRejectedValue(new Error('private failure'));
  expect(await loadHouseholdGameplay(now)).toEqual({ available: false });
});
