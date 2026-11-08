import { plusCredentials } from './crossword-plus.js';
import type { GameplayAudience, GameplayPlatform, GameplayReport, GameplaySegment } from '../../src/types/gameplay.js';

const DAY = 86400_000;
const PAGE = 1000;
const MAX_ROWS = 50_000;
const PLATFORMS: GameplayAudience[] = ['all', 'ios', 'android', 'web', 'other'];
export type PlayRow = {
  id: string; user_id: string; started_at: string; client: string; signed_in: boolean;
  mode: string; completed: boolean; cells_filled: number; cells_at_start: number; wrong_letters: number;
};
type Profile = { user_id: string; username: string };
const SELECT = 'id,user_id,started_at,client,signed_in,mode,completed,cells_filled,cells_at_start,wrong_letters';
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const platform = (client: string): GameplayPlatform => client === 'ios' || client === 'android' || client === 'web' ? client : 'other';
// Same attempt definition as Crossword Clash's insights_puzzles SQL.
export const isAttempt = (row: PlayRow) => row.cells_filled > row.cells_at_start || row.wrong_letters > 0 || row.completed;

export function gameplayWindow(days: number, now = Date.now()) {
  const to = Date.parse(`${date(now)}T00:00:00Z`);
  const from = to - days * DAY;
  return { from, to, lookbackFrom: from - 90 * DAY };
}

export function summarizeGameplay(rows: PlayRow[], profiles: Profile[], days: number, now = Date.now(), profilesAvailable = true): GameplayReport {
  const window = gameplayWindow(days, now);
  const inWindow = rows.filter(row => Date.parse(row.started_at) >= window.lookbackFrom && Date.parse(row.started_at) < window.to);
  const names = new Map(profiles.map(p => [p.user_id, p.username]));
  const segments = {} as Record<GameplayAudience, GameplaySegment>;
  for (const audience of PLATFORMS) {
    const eligible = inWindow.filter(row => isAttempt(row) && (audience === 'all' || platform(row.client) === audience));
    const prior = new Set(eligible.filter(row => Date.parse(row.started_at) < window.from).map(row => row.user_id));
    const current = eligible.filter(row => Date.parse(row.started_at) >= window.from);
    const users = new Map<string, PlayRow[]>();
    for (const row of current) {
      if (!users.has(row.user_id)) users.set(row.user_id, []);
      users.get(row.user_id)!.push(row);
    }
    const count = (rs: PlayRow[]) => ({ players: new Set(rs.map(row => row.user_id)).size, attempts: rs.length, completions: rs.filter(row => row.completed).length });
    const activeDays = (rs: PlayRow[]) => new Set(rs.map(row => row.started_at.slice(0, 10))).size;
    segments[audience] = {
      ...count(current),
      returning: [...users.keys()].filter(id => prior.has(id)).length,
      firstSeen: [...users.keys()].filter(id => !prior.has(id)).length,
      repeatDays: [...users.values()].filter(rs => activeDays(rs) > 1).length,
      signedIn: [...users.values()].filter(rs => rs.some(row => row.signed_in)).length,
      solo: current.filter(row => row.mode === 'solo').length,
      multiplayer: current.filter(row => row.mode !== 'solo').length,
      daily: Array.from({ length: days }, (_, i) => {
        const day = date(window.from + i * DAY);
        return { date: day, ...count(current.filter(row => row.started_at.startsWith(day))) };
      }),
      registeredPlayers: [...users.entries()].filter(([id, rs]) => names.has(id) && rs.some(row => row.signed_in))
        .map(([id, rs]) => ({ username: names.get(id)!, attempts: rs.length, completions: rs.filter(row => row.completed).length,
          days: activeDays(rs), lastPlayed: rs.map(row => row.started_at).sort().at(-1)!, platforms: [...new Set(rs.map(row => platform(row.client)))] }))
        .sort((a, b) => b.attempts - a.attempts || a.username.localeCompare(b.username)).slice(0, 20),
    };
  }
  const timestamps = inWindow.map(row => row.started_at).sort();
  return {
    available: true, generatedAt: new Date(now).toISOString(),
    range: { from: date(window.from), through: date(window.to - DAY), lookbackFrom: date(window.lookbackFrom) },
    coverage: { earliestRecord: timestamps[0] ?? null, latestRecord: timestamps.at(-1) ?? null, profilesAvailable }, segments,
  };
}

function isPlayRow(value: unknown): value is PlayRow {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return ['id', 'user_id', 'started_at', 'client', 'mode'].every(key => typeof r[key] === 'string')
    && Number.isFinite(Date.parse(r.started_at as string)) && typeof r.signed_in === 'boolean' && typeof r.completed === 'boolean'
    && ['cells_filled', 'cells_at_start', 'wrong_letters'].every(key => typeof r[key] === 'number' && Number.isFinite(r[key]));
}

/** Only GETs, with a bounded read and no persisted copy of identities or credentials. */
export async function loadCrosswordGameplay(days: number, now = Date.now(), env = process.env): Promise<GameplayReport> {
  const { url, key } = plusCredentials(env);
  if (!key) return { available: false, reason: 'Gameplay is awaiting its private Crossword Clash connection.' };
  try {
    if (!url.startsWith('https://')) throw new Error('connection');
    const signal = AbortSignal.timeout(25_000);
    const get = async (table: string, query: URLSearchParams): Promise<unknown[]> => {
      const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }, redirect: 'error', signal,
      });
      if (!response.ok) throw new Error('connection');
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('response');
      return data;
    };
    const { lookbackFrom, to } = gameplayWindow(days, now);
    const rows: PlayRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      if (offset >= MAX_ROWS) throw new Error('limit');
      const page = await get('play_sessions', new URLSearchParams({ select: SELECT,
        and: `(started_at.gte.${new Date(lookbackFrom).toISOString()},started_at.lt.${new Date(to).toISOString()})`,
        order: 'started_at.asc,id.asc', limit: String(PAGE), offset: String(offset) }));
      if (!page.every(isPlayRow)) throw new Error('response');
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    const { from } = gameplayWindow(days, now);
    const ids = [...new Set(rows.filter(row => Date.parse(row.started_at) >= from && isAttempt(row) && row.signed_in).map(row => row.user_id))];
    const profiles: Profile[] = [];
    let profilesAvailable = true;
    try {
      for (let i = 0; i < ids.length; i += 80) {
        const page = await get('profiles', new URLSearchParams({ select: 'user_id,username', user_id: `in.(${ids.slice(i, i + 80).join(',')})`, limit: '80' }));
        for (const item of page) {
          if (!item || typeof item !== 'object' || !('user_id' in item) || !('username' in item) || typeof item.user_id !== 'string' || typeof item.username !== 'string') throw new Error('response');
          profiles.push({ user_id: item.user_id, username: item.username });
        }
      }
    } catch { profilesAvailable = false; profiles.length = 0; }
    return summarizeGameplay(rows, profiles, days, now, profilesAvailable);
  } catch {
    return { available: false, reason: 'Gameplay could not be read completely. Try refreshing; missing data is not counted as zero.' };
  }
}
