import type { VercelRequest, VercelResponse } from '@vercel/node';

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY?.trim();
const POSTHOG_HOST = 'https://us.posthog.com';

const POSTHOG_PROJECTS: Record<string, number> = {
  'space-explorer': 367489,
};

const EVENT_LABELS: Record<string, string> = {
  planet_viewed: 'Planets Viewed',
  moon_viewed: 'Moons Viewed',
  sun_viewed: 'Sun Viewed',
  voice_agent_activated: 'Voice Agent',
  exploration_milestone: 'Milestones',
};

const TRACKED_EVENTS = Object.keys(EVENT_LABELS);

function rangeToDateFrom(range: string): string {
  const days = parseInt(range.replace('d', ''), 10) || 30;
  return `-${days}d`;
}

function intervalForRange(range: string): string {
  const days = parseInt(range.replace('d', ''), 10) || 30;
  if (days <= 1) return 'hour';
  return 'day';
}

async function posthogQuery(projectId: number, query: Record<string, unknown>) {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${POSTHOG_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog API error ${res.status}: ${text}`);
  }
  return res.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const project = (req.query.project as string) || '';
    const range = (req.query.range as string) || '30d';
    const projectId = POSTHOG_PROJECTS[project];

    if (!projectId || !POSTHOG_API_KEY) {
      return res.json({ totals: [], timeseries: [], topPlanets: [] });
    }

    const dateFrom = rangeToDateFrom(range);
    const interval = intervalForRange(range);

    const trendsQuery = {
      kind: 'TrendsQuery',
      series: TRACKED_EVENTS.map((event) => ({
        kind: 'EventsNode',
        event,
        math: 'total',
      })),
      dateRange: { date_from: dateFrom },
      interval,
    };

    const breakdownQuery = {
      kind: 'TrendsQuery',
      series: [
        {
          kind: 'EventsNode',
          event: 'planet_viewed',
          math: 'total',
        },
      ],
      breakdownFilter: {
        breakdown_type: 'event',
        breakdown: 'planet_id',
      },
      dateRange: { date_from: dateFrom },
      interval,
    };

    const [trendsResult, breakdownResult] = await Promise.all([
      posthogQuery(projectId, trendsQuery),
      posthogQuery(projectId, breakdownQuery).catch(() => null),
    ]);

    const results = trendsResult.results || [];

    const totals = results.map((series: any, i: number) => ({
      event: TRACKED_EVENTS[i],
      label: EVENT_LABELS[TRACKED_EVENTS[i]],
      count: (series.data as number[]).reduce((a: number, b: number) => a + b, 0),
    }));

    const timeseriesMap = new Map<string, Record<string, number>>();
    for (let i = 0; i < results.length; i++) {
      const eventName = TRACKED_EVENTS[i];
      const series = results[i];
      const days = series.days || series.labels || [];
      const data = series.data || [];
      for (let j = 0; j < days.length; j++) {
        const dateKey = String(days[j]).slice(0, 10).replace(/-/g, '');
        let entry = timeseriesMap.get(dateKey);
        if (!entry) {
          entry = { date: dateKey };
          timeseriesMap.set(dateKey, entry);
        }
        entry[eventName] = (entry[eventName] || 0) + (data[j] || 0);
      }
    }
    const timeseries = Array.from(timeseriesMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    let topPlanets: { name: string; count: number }[] = [];
    if (breakdownResult?.results) {
      topPlanets = breakdownResult.results
        .map((series: any) => ({
          name: series.breakdown_value || series.label || 'unknown',
          count: (series.data as number[]).reduce((a: number, b: number) => a + b, 0),
        }))
        .filter((p: any) => p.count > 0)
        .sort((a: any, b: any) => b.count - a.count)
        .slice(0, 10);
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ totals, timeseries, topPlanets });
  } catch (error) {
    console.error('PostHog API error:', error);
    res.status(500).json({ error: 'Failed to fetch PostHog data' });
  }
}
