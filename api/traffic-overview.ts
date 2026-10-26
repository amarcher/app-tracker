import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GA4_PROPERTIES, getGa4Client } from './_shared/ga4.js';
import { fetchTrafficTotals, trafficWindow, trafficNote } from './_shared/traffic.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;
    const client = getGa4Client();
    const now = Date.now();
    const results = await Promise.all(Object.entries(GA4_PROPERTIES).map(async ([project, propertyId]) => {
      if (!propertyId) return { project, current: null, previous: null, reason: 'No GA4 property configured' };
      const [current, previous] = await Promise.allSettled([
        fetchTrafficTotals(client, propertyId, trafficWindow(days, project, false, now)),
        fetchTrafficTotals(client, propertyId, trafficWindow(days, project, true, now)),
      ]);
      return {
        project,
        current: current.status === 'fulfilled' ? current.value : null,
        previous: previous.status === 'fulfilled' ? previous.value : null,
        reason: 'Traffic query failed',
      };
    }));
    const change = (current: number, previous: number | undefined) => previous && previous > 0 ? (current - previous) / previous * 100 : null;
    const projects = results.flatMap(r => r.current ? [{
      project: r.project,
      current: r.current,
      previous: r.previous,
      usersChangePct: change(r.current.users, r.previous?.users),
      pageviewsChangePct: change(r.current.pageviews, r.previous?.pageviews),
    }] : []).sort((a, b) => b.current.users - a.current.users);
    const unavailable = results.filter(r => !r.current).map(r => ({ project: r.project, reason: r.reason }));
    const comparisonUnavailable = projects.filter(p => !p.previous).map(p => p.project);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ projects, unavailable, comparisonUnavailable, range, note: trafficNote(days) });
  } catch {
    res.status(500).json({ error: 'Failed to fetch traffic overview' });
  }
}
