import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;
    const project = (req.query.project as string) || 'animal-penpals';

    const [timeseries, totals, recentCalls] = await Promise.all([
      sql`SELECT date_trunc('day', timestamp)::date as day, service,
            SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out,
            SUM(characters) as characters, COUNT(*) as requests
          FROM api_usage
          WHERE project = ${project} AND timestamp > NOW() - make_interval(days => ${days})
          GROUP BY day, service
          ORDER BY day`,
      sql`SELECT service,
            SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out,
            SUM(characters) as characters, COUNT(*) as requests
          FROM api_usage
          WHERE project = ${project} AND timestamp > NOW() - make_interval(days => ${days})
          GROUP BY service`,
      sql`SELECT timestamp, service, endpoint, tokens_in, tokens_out, characters, model, metadata
          FROM api_usage
          WHERE project = ${project}
          ORDER BY timestamp DESC
          LIMIT 20`,
    ]);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.json({ timeseries, totals, recentCalls });
  } catch (error) {
    console.error('API usage query error:', error);
    res.status(500).json({ error: 'Failed to fetch API usage data' });
  }
}
