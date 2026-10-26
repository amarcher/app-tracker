import type { BetaAnalyticsDataClient } from '@google-analytics/data';
import { tzForProject } from './timezone.js';

const HOUR = 3_600_000;
function dateHour(epoch: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(epoch);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}${values.month}${values.day}${values.hour}`;
}
function isoDate(hour: string): string {
  return `${hour.slice(0, 4)}-${hour.slice(4, 6)}-${hour.slice(6, 8)}`;
}

export function trafficWindow(days: number, project: string, previous = false, now = Date.now()) {
  const timezone = tzForProject(project);
  if (days === 1) {
    // GA4 only resolves hours. Use completed hours and ask GA4 to deduplicate
    // users over the whole window; never add up hourly user counts.
    const end = Math.floor(now / HOUR) * HOUR - (previous ? 24 : 0) * HOUR;
    const values = [...new Set(Array.from({ length: 24 }, (_, i) => dateHour(end - (24 - i) * HOUR, timezone)))];
    return {
      dateRanges: [{ startDate: isoDate(values[0]), endDate: isoDate(values[values.length - 1]) }],
      dimensionFilter: { filter: { fieldName: 'dateHour', inListFilter: { values } } },
    };
  }
  const today = new Date(`${isoDate(dateHour(now, timezone))}T00:00:00Z`);
  const offset = (n: number) => new Date(today.getTime() - n * 24 * HOUR).toISOString().slice(0, 10);
  return { dateRanges: [{ startDate: offset(previous ? 2 * days - 1 : days - 1), endDate: offset(previous ? days : 0) }] };
}

export const TRAFFIC_METRICS = ['screenPageViews', 'sessions', 'totalUsers', 'newUsers', 'engagementRate', 'averageSessionDuration', 'bounceRate'].map(name => ({ name }));

export async function fetchTrafficTotals(client: BetaAnalyticsDataClient, propertyId: string, window: ReturnType<typeof trafficWindow>) {
  const [response] = await client.runReport({ property: `properties/${propertyId}`, ...window, metrics: TRAFFIC_METRICS });
  const row = response.rows?.[0];
  const value = (i: number) => Number(row?.metricValues?.[i]?.value ?? 0);
  return { pageviews: value(0), sessions: value(1), users: value(2), newUsers: value(3), engagementRate: value(4), avgSessionDuration: value(5), bounceRate: value(6) };
}

export function trafficNote(days: number) {
  return days === 1
    ? 'Last 24 completed hourly buckets in each property timezone; GA4 processing may still be incomplete. DST repeated hours cannot be separated.'
    : 'Includes today in each property timezone; today is partial and GA4 processing may lag. Comparisons include a partial current day.';
}
