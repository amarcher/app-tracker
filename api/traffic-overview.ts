import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { parseDateHour, tzForProject } from './_shared/timezone.js';

const env = (name: string) => (process.env[name] ?? '').trim();

const PROPERTIES: Record<string, string> = {
  'animal-penpals': env('GA4_PROPERTY_ID'),
  'space-explorer': env('GA4_PROPERTY_ID_SPACE_EXPLORER'),
  'periodic-table': env('GA4_PROPERTY_ID_PERIODIC_TABLE'),
  'crossword-clash': env('GA4_PROPERTY_ID_CROSSWORD_CLASH'),
  'ticket-for-dinner': env('GA4_PROPERTY_ID_TICKET_FOR_DINNER'),
  'superbowl-squares': env('GA4_PROPERTY_ID_SUPERBOWL_SQUARES'),
  'tabbit-rabbit': env('GA4_PROPERTY_ID_TABBIT_RABBIT'),
  'mark-my-words': env('GA4_PROPERTY_ID_MARK_MY_WORDS'),
};

function getClient() {
  const keyJson = env('GA4_KEY_JSON');
  if (keyJson) {
    const credentials = JSON.parse(keyJson);
    return new BetaAnalyticsDataClient({ credentials });
  }
  const keyFile = env('GOOGLE_APPLICATION_CREDENTIALS');
  if (keyFile) {
    return new BetaAnalyticsDataClient({ keyFilename: keyFile });
  }
  return new BetaAnalyticsDataClient();
}

function daysAgoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

interface ProjectTotals {
  pageviews: number;
  sessions: number;
  users: number;
  newUsers: number;
  engagementRate: number;
  avgSessionDuration: number;
}

const EMPTY_TOTALS: ProjectTotals = {
  pageviews: 0, sessions: 0, users: 0, newUsers: 0, engagementRate: 0, avgSessionDuration: 0,
};

async function fetchTotals(
  client: BetaAnalyticsDataClient,
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<ProjectTotals> {
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'engagementRate' },
      { name: 'averageSessionDuration' },
    ],
  });
  const row = response.rows?.[0];
  if (!row) return { ...EMPTY_TOTALS };
  return {
    pageviews: parseInt(row.metricValues![0].value!, 10),
    sessions: parseInt(row.metricValues![1].value!, 10),
    users: parseInt(row.metricValues![2].value!, 10),
    newUsers: parseInt(row.metricValues![3].value!, 10),
    engagementRate: parseFloat(row.metricValues![4].value!),
    avgSessionDuration: parseFloat(row.metricValues![5].value!),
  };
}

// True rolling 24h vs prior 24h, using GA4's dateHour dimension.
// Returns { current: [now-24h, now], previous: [now-48h, now-24h] }.
// Note: `totalUsers` summed across hourly rows slightly overcounts users who were
// active in multiple hours. Pageviews/sessions/newUsers are truly additive.
// Engagement rate and session duration are re-weighted by sessions.
// dateHour strings are parsed using the property's configured timezone (see
// api/_shared/timezone.ts) so the 24h boundary lands on the right wall-clock
// moment.
async function fetchRolling24h(
  client: BetaAnalyticsDataClient,
  propertyId: string,
  tz: string,
): Promise<{ current: ProjectTotals; previous: ProjectTotals }> {
  // Fetch 3 calendar days of hourly buckets to safely cover the last 48h
  // regardless of the property's timezone.
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: daysAgoDate(2), endDate: 'today' }],
    dimensions: [{ name: 'dateHour' }],
    // Use engagedSessions rather than engagementRate — GA4 returns 0 for
    // engagementRate when grouped by dateHour. We compute the ratio below.
    metrics: [
      { name: 'screenPageViews' },
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'engagedSessions' },
      { name: 'averageSessionDuration' },
    ],
    orderBys: [{ dimension: { dimensionName: 'dateHour' } }],
    limit: 500,
  });

  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const current: ProjectTotals = { ...EMPTY_TOTALS };
  const previous: ProjectTotals = { ...EMPTY_TOTALS };
  // Raw accumulators: sum engagedSessions + sessions across hours, then
  // divide at the end. Session duration is session-weighted.
  let curEngaged = 0, curDurSum = 0;
  let prevEngaged = 0, prevDurSum = 0;

  for (const row of response.rows || []) {
    const dh = row.dimensionValues![0].value!; // YYYYMMDDHH in property tz
    const rowMs = parseDateHour(dh, tz);
    const ageMs = nowMs - rowMs;
    if (ageMs < 0 || ageMs >= 2 * DAY_MS) continue;

    const pageviews = parseInt(row.metricValues![0].value!, 10);
    const sessions = parseInt(row.metricValues![1].value!, 10);
    const users = parseInt(row.metricValues![2].value!, 10);
    const newUsers = parseInt(row.metricValues![3].value!, 10);
    const engagedSessions = parseInt(row.metricValues![4].value!, 10);
    const avgDur = parseFloat(row.metricValues![5].value!);

    const bucket = ageMs < DAY_MS ? 'current' : 'previous';
    if (bucket === 'current') {
      current.pageviews += pageviews;
      current.sessions += sessions;
      current.users += users;
      current.newUsers += newUsers;
      curEngaged += engagedSessions;
      curDurSum += avgDur * sessions;
    } else {
      previous.pageviews += pageviews;
      previous.sessions += sessions;
      previous.users += users;
      previous.newUsers += newUsers;
      prevEngaged += engagedSessions;
      prevDurSum += avgDur * sessions;
    }
  }

  current.engagementRate = current.sessions > 0 ? curEngaged / current.sessions : 0;
  current.avgSessionDuration = current.sessions > 0 ? curDurSum / current.sessions : 0;
  previous.engagementRate = previous.sessions > 0 ? prevEngaged / previous.sessions : 0;
  previous.avgSessionDuration = previous.sessions > 0 ? prevDurSum / previous.sessions : 0;

  return { current, previous };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;

    // For days=1: true rolling 24h window using the dateHour dimension.
    // For days>1: last N calendar days (inclusive of today) vs the N days before.
    const client = getClient();
    const entries = Object.entries(PROPERTIES).filter(([, id]) => !!id);

    const results = await Promise.all(
      entries.map(async ([project, propertyId]) => {
        if (days === 1) {
          const tz = tzForProject(project);
          const settled = await Promise.allSettled([fetchRolling24h(client, propertyId, tz)]);
          const res = settled[0];
          return {
            project,
            current: res.status === 'fulfilled' ? res.value.current : null,
            previous: res.status === 'fulfilled' ? res.value.previous : null,
            error: res.status === 'rejected' ? String(res.reason) : null,
          };
        }
        const currentStart = daysAgoDate(days - 1);
        const currentEnd = 'today';
        const prevStart = daysAgoDate(days * 2 - 1);
        const prevEnd = daysAgoDate(days);
        const [current, previous] = await Promise.allSettled([
          fetchTotals(client, propertyId, currentStart, currentEnd),
          fetchTotals(client, propertyId, prevStart, prevEnd),
        ]);
        return {
          project,
          current: current.status === 'fulfilled' ? current.value : null,
          previous: previous.status === 'fulfilled' ? previous.value : null,
          error: current.status === 'rejected' ? String(current.reason) : null,
        };
      }),
    );

    const projects = results
      .filter((r) => r.current !== null)
      .map((r) => {
        const cur = r.current!;
        const prev = r.previous;
        const usersChangePct = prev && prev.users > 0
          ? ((cur.users - prev.users) / prev.users) * 100
          : cur.users > 0 ? 100 : 0;
        const pageviewsChangePct = prev && prev.pageviews > 0
          ? ((cur.pageviews - prev.pageviews) / prev.pageviews) * 100
          : cur.pageviews > 0 ? 100 : 0;
        return {
          project: r.project,
          current: cur,
          previous: prev,
          usersChangePct,
          pageviewsChangePct,
        };
      })
      .sort((a, b) => b.current.users - a.current.users);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ projects, range });
  } catch (error) {
    console.error('Traffic overview error:', error);
    res.status(500).json({ error: 'Failed to fetch traffic overview' });
  }
}
