import type { VercelRequest, VercelResponse } from '@vercel/node';

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY?.trim();
const POSTHOG_HOST = 'https://us.posthog.com';

const POSTHOG_PROJECT_ID = 367489;

interface ProjectConfig {
  events: Record<string, string>;
  breakdownEvent?: string;
  breakdownProperty?: string;
  breakdownLabel?: string;
}

const PROJECT_CONFIGS: Record<string, ProjectConfig> = {
  'space-explorer': {
    events: {
      planet_viewed: 'Planets Viewed',
      moon_viewed: 'Moons Viewed',
      sun_viewed: 'Sun Viewed',
      voice_agent_activated: 'Voice Agent',
      exploration_milestone: 'Milestones',
    },
    breakdownEvent: 'planet_viewed',
    breakdownProperty: 'planet_id',
    breakdownLabel: 'topItems',
  },
  'animal-penpals': {
    events: {
      animal_selected: 'Animals Selected',
      letter_sent: 'Letters Sent',
      letter_received: 'Letters Received',
      tts_playback_started: 'TTS Plays',
      tts_playback_completed: 'TTS Completed',
      reply_clicked: 'Replies',
      video_loop: 'Video Loops',
    },
    breakdownEvent: 'animal_selected',
    breakdownProperty: 'animal_id',
    breakdownLabel: 'topItems',
  },
  'periodic-table': {
    events: {
      element_opened: 'Elements Opened',
      element_closed: 'Elements Closed',
      phase_diagram_used: 'Phase Diagram',
      valence_toggle: 'Valence Toggle',
      orbital_filter: 'Orbital Filter',
      video_play_toggle: 'Video Toggle',
      voice_agent_activated: 'Voice Agent',
    },
    breakdownEvent: 'element_opened',
    breakdownProperty: 'symbol',
    breakdownLabel: 'topItems',
  },
};

function rangeToDateFrom(range: string): string {
  const days = parseInt(range.replace('d', ''), 10) || 30;
  return `-${days}d`;
}

function intervalForRange(range: string): string {
  const days = parseInt(range.replace('d', ''), 10) || 30;
  if (days <= 1) return 'hour';
  return 'day';
}

async function posthogQuery(query: Record<string, unknown>) {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
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
    const config = PROJECT_CONFIGS[project];

    if (!config || !POSTHOG_API_KEY) {
      return res.json({ totals: [], timeseries: [], topItems: [] });
    }

    const eventNames = Object.keys(config.events);
    const eventLabels = config.events;
    const dateFrom = rangeToDateFrom(range);
    const interval = intervalForRange(range);

    const trendsQuery = {
      kind: 'TrendsQuery',
      series: eventNames.map((event) => ({
        kind: 'EventsNode',
        event,
        math: 'total',
      })),
      dateRange: { date_from: dateFrom },
      interval,
    };

    const breakdownQuery = config.breakdownEvent ? {
      kind: 'TrendsQuery',
      series: [
        {
          kind: 'EventsNode',
          event: config.breakdownEvent,
          math: 'total',
        },
      ],
      breakdownFilter: {
        breakdown_type: 'event',
        breakdown: config.breakdownProperty,
      },
      dateRange: { date_from: dateFrom },
      interval,
    } : null;

    const [trendsResult, breakdownResult] = await Promise.all([
      posthogQuery(trendsQuery),
      breakdownQuery
        ? posthogQuery(breakdownQuery).catch(() => null)
        : Promise.resolve(null),
    ]);

    const results = trendsResult.results || [];

    const totals = results.map((series: any, i: number) => ({
      event: eventNames[i],
      label: eventLabels[eventNames[i]],
      count: (series.data as number[]).reduce((a: number, b: number) => a + b, 0),
    }));

    type TimeseriesEntry = { date: string; [event: string]: string | number };
    const timeseriesMap = new Map<string, TimeseriesEntry>();
    for (let i = 0; i < results.length; i++) {
      const eventName = eventNames[i];
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
        entry[eventName] = (Number(entry[eventName]) || 0) + (data[j] || 0);
      }
    }
    const timeseries = Array.from(timeseriesMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    let topItems: { name: string; count: number }[] = [];
    if (breakdownResult?.results) {
      topItems = breakdownResult.results
        .map((series: any) => ({
          name: series.breakdown_value || series.label || 'unknown',
          count: (series.data as number[]).reduce((a: number, b: number) => a + b, 0),
        }))
        .filter((p: any) => p.count > 0)
        .sort((a: any, b: any) => b.count - a.count)
        .slice(0, 10);
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ totals, timeseries, topItems });
  } catch (error) {
    console.error('PostHog API error:', error);
    res.status(500).json({ error: 'Failed to fetch PostHog data' });
  }
}
