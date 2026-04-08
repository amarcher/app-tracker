// Shared timezone helpers for rolling-window computations against GA4.
//
// GA4 properties report `dateHour` buckets in the property's configured
// timezone, not UTC. To compare those buckets to `Date.now()` (UTC on Vercel)
// we need to know each property's wall-clock tz and convert.

// Default timezone for GA4 properties that don't have an explicit override.
// Update if your account default is different. Google typically seeds new
// properties with the creator's local timezone.
export const DEFAULT_GA4_TIMEZONE = 'America/New_York';

// Per-project overrides. Fill in only if a specific GA4 property is configured
// with a different timezone than DEFAULT_GA4_TIMEZONE.
// Project keys here must match the keys used in PROPERTIES (e.g. 'animal-penpals').
export const GA4_TIMEZONES: Record<string, string> = {
  // 'periodic-table': 'America/New_York',
};

export function tzForProject(project: string): string {
  return GA4_TIMEZONES[project] ?? DEFAULT_GA4_TIMEZONE;
}

// Returns the offset (in ms) that should be ADDED to a UTC epoch ms to get
// the wall-clock reading a user in `tz` would see at that moment.
// Example: at 12:00 UTC in America/Los_Angeles during PDT, offset is -7h
// (because a PDT observer sees 05:00).
function tzOffsetAtMs(epochMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(epochMs));
  const obj: Record<string, string> = {};
  for (const p of parts) obj[p.type] = p.value;
  // `Intl` sometimes emits hour "24" for midnight; normalize to 0.
  const hour = obj.hour === '24' ? 0 : +obj.hour;
  const asIfUtc = Date.UTC(+obj.year, +obj.month - 1, +obj.day, hour, +obj.minute, +obj.second);
  return asIfUtc - epochMs;
}

// Convert a wall-clock time (year/month/day/hour) in a named tz to epoch ms.
// Handles DST correctly except at the ambiguous "spring forward" / "fall back"
// hour, where the result may be off by one hour — acceptable for dashboards.
export function wallTimeToEpochMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  tz: string,
): number {
  const naiveUtc = Date.UTC(year, month - 1, day, hour);
  const offset = tzOffsetAtMs(naiveUtc, tz);
  return naiveUtc - offset;
}

// Parse a GA4 dateHour string (YYYYMMDDHH) as the start of that wall-clock
// hour in the given tz, returning epoch ms.
export function parseDateHour(dateHour: string, tz: string): number {
  const year = parseInt(dateHour.slice(0, 4), 10);
  const month = parseInt(dateHour.slice(4, 6), 10);
  const day = parseInt(dateHour.slice(6, 8), 10);
  const hour = parseInt(dateHour.slice(8, 10), 10);
  return wallTimeToEpochMs(year, month, day, hour, tz);
}
