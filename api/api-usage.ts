import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

// Pricing per million tokens/characters (approximate, early 2026)
const PRICING: Record<string, { inputPerM: number; outputPerM: number; charsPerM?: number }> = {
  'claude-sonnet-4-20250514': { inputPerM: 3, outputPerM: 15 },
  'claude-haiku-4-5-20251001': { inputPerM: 0.80, outputPerM: 4 },
};
const ELEVENLABS_CHARS_PER_M = 0.30;

function estimateCost(service: string, model: string | null, tokensIn: number, tokensOut: number, characters: number): number {
  if (service === 'anthropic' && model && PRICING[model]) {
    return (tokensIn * PRICING[model].inputPerM + tokensOut * PRICING[model].outputPerM) / 1_000_000;
  }
  if (service === 'elevenlabs') {
    return (characters * ELEVENLABS_CHARS_PER_M) / 1_000_000;
  }
  return 0;
}

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
      sql`SELECT service, model,
            SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out,
            SUM(characters) as characters, COUNT(*) as requests
          FROM api_usage
          WHERE project = ${project} AND timestamp > NOW() - make_interval(days => ${days})
          GROUP BY service, model`,
      sql`SELECT timestamp, service, endpoint, tokens_in, tokens_out, characters, model, metadata
          FROM api_usage
          WHERE project = ${project}
          ORDER BY timestamp DESC
          LIMIT 20`,
    ]);

    // Calculate estimated costs
    let totalCost = 0;
    const totalsWithCost = totals.map((t: any) => {
      const cost = estimateCost(t.service, t.model, Number(t.tokens_in), Number(t.tokens_out), Number(t.characters));
      totalCost += cost;
      return { ...t, estimatedCost: cost };
    });

    // Aggregate totals by service (collapse model-level rows)
    const serviceMap = new Map<string, any>();
    for (const t of totalsWithCost) {
      const existing = serviceMap.get(t.service);
      if (existing) {
        existing.tokens_in += Number(t.tokens_in);
        existing.tokens_out += Number(t.tokens_out);
        existing.characters += Number(t.characters);
        existing.requests += Number(t.requests);
        existing.estimatedCost += t.estimatedCost;
      } else {
        serviceMap.set(t.service, {
          service: t.service,
          tokens_in: Number(t.tokens_in),
          tokens_out: Number(t.tokens_out),
          characters: Number(t.characters),
          requests: Number(t.requests),
          estimatedCost: t.estimatedCost,
        });
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.json({
      timeseries,
      totals: Array.from(serviceMap.values()),
      recentCalls,
      totalCost,
    });
  } catch (error) {
    console.error('API usage query error:', error);
    res.status(500).json({ error: 'Failed to fetch API usage data' });
  }
}
