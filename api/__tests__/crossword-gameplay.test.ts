import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameplayWindow, loadCrosswordGameplay, summarizeGameplay, type PlayRow } from '../_shared/crossword-gameplay';

const now = Date.parse('2026-11-08T05:00:00Z');
const row = (changes: Partial<PlayRow> = {}): PlayRow => ({ id: 'visit', user_id: 'player', started_at: '2026-11-04T12:00:00Z', client: 'ios', signed_in: false, mode: 'solo', completed: false, cells_filled: 1, cells_at_start: 0, wrong_letters: 0, ...changes });
const env = { CROSSWORD_CLASH_SUPABASE_SERVICE_KEY: 'private-test-key' };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('gameplay counts', () => {
  it('deduplicates identities across days and platforms; distinguishes attempts from opens and repeat completions', () => {
    const report = summarizeGameplay([
      row({ id: 'prior', started_at: '2026-10-20T12:00:00Z' }),
      row({ id: 'a', completed: true, signed_in: true }),
      row({ id: 'b', client: 'web', started_at: '2026-11-05T12:00:00Z', signed_in: true }),
      row({ id: 'c', user_id: 'anonymous', client: 'android', cells_filled: 0, wrong_letters: 1 }),
      row({ id: 'open', user_id: 'nonplayer', cells_filled: 4, cells_at_start: 4 }),
      row({ id: 'today', user_id: 'today', started_at: '2026-11-08T00:00:00Z' }),
    ], [{ user_id: 'player', username: 'Solver' }], 7, now);
    if (!report.available) throw new Error('report');
    expect(report.range).toEqual({ from: '2026-11-01', through: '2026-11-07', lookbackFrom: '2026-08-03' });
    expect(report.segments.all).toMatchObject({ players: 2, attempts: 3, completions: 1, returning: 1, firstSeen: 1, repeatDays: 1, signedIn: 1, solo: 3, multiplayer: 0 });
    expect(report.segments.ios.players + report.segments.android.players + report.segments.web.players).toBe(3);
    expect(report.segments.web.returning).toBe(0); // No earlier web play by this account.
    expect(report.segments.all.daily).toHaveLength(7);
    expect(report.segments.all.daily[0]).toEqual({ date: '2026-11-01', players: 0, attempts: 0, completions: 0 });
    expect(report.segments.all.registeredPlayers).toEqual([{ username: 'Solver', attempts: 2, completions: 1, days: 2, lastPlayed: '2026-11-05T12:00:00Z', platforms: ['ios', 'web'] }]);
    expect(JSON.stringify(report)).not.toContain('user_id');
    expect(JSON.stringify(report)).not.toContain('nonplayer');
  });

  it('uses completed UTC days over DST, counts resumed completions, and preserves unknown platforms', () => {
    expect(gameplayWindow(1, now).to - gameplayWindow(1, now).from).toBe(86400_000);
    const report = summarizeGameplay([row({ client: 'future', started_at: '2026-11-07T23:59:59Z', cells_filled: 0, completed: true, mode: 'versus' })], [], 1, now);
    if (!report.available) throw new Error('report');
    expect(report.segments.other).toMatchObject({ players: 1, attempts: 1, completions: 1, multiplayer: 1 });
    expect(report.range.from).toBe('2026-11-07');
  });

  it('does not treat history outside the lookback or non-attempt history as returning', () => {
    const report = summarizeGameplay([row(), row({ started_at: '2026-08-02T23:59:59Z' }), row({ started_at: '2026-10-01T00:00:00Z', cells_filled: 0 })], [], 7, now);
    if (!report.available) throw new Error('report');
    expect(report.segments.all).toMatchObject({ returning: 0, firstSeen: 1 });
  });
});

describe('private gameplay reader', () => {
  it('leaves an unconnected source unavailable, without making requests', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await loadCrosswordGameplay(7, now, {})).toMatchObject({ available: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('paginates past 1,000 visits with stable ordering and only returns aggregate counts and registered names', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 1000 }, (_, i) => row({ id: String(i) })))))
      .mockResolvedValueOnce(new Response(JSON.stringify([row({ id: 'last', user_id: 'registered', signed_in: true })])))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ user_id: 'registered', username: 'Solver' }])));
    vi.stubGlobal('fetch', fetcher);
    const report = await loadCrosswordGameplay(7, now, env);
    if (!report.available) throw new Error('report');
    expect(report.segments.all).toMatchObject({ attempts: 1001, players: 2, signedIn: 1 });
    expect(report.segments.all.registeredPlayers[0].username).toBe('Solver');
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('offset')).toBe('1000');
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('order')).toBe('started_at.asc,id.asc');
    expect(new URL(fetcher.mock.calls[2][0]).searchParams.get('select')).toBe('user_id,username');
    expect(JSON.stringify(report)).not.toContain('private-test-key');
  });

  it('does not silently return partial totals when a later page fails or data is malformed', async () => {
    for (const last of [new Response('source error with private material', { status: 500 }), new Response(JSON.stringify([{ broken: true }]))]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 1000 }, (_, i) => row({ id: String(i) })))))
        .mockResolvedValueOnce(last));
      const report = await loadCrosswordGameplay(7, now, env);
      expect(report.available).toBe(false);
      expect(JSON.stringify(report)).not.toContain('private material');
      expect(report).not.toHaveProperty('segments');
    }
  });

  it('keeps counts when names cannot be read and reports that gap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([row({ signed_in: true })])))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 })));
    const report = await loadCrosswordGameplay(7, now, env);
    if (!report.available) throw new Error('report');
    expect(report.coverage.profilesAvailable).toBe(false);
    expect(report.segments.all.players).toBe(1);
    expect(report.segments.all.registeredPlayers).toEqual([]);
  });
});
