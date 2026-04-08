import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

// Same pricing as api-usage.ts
const PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-sonnet-4-20250514': { inputPerM: 3, outputPerM: 15 },
  'claude-haiku-4-5-20251001': { inputPerM: 0.80, outputPerM: 4 },
};
const ELEVENLABS_CHARS_PER_M = 0.30;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const sql = neon(process.env.DATABASE_URL!.trim());
    const range = (req.query.range as string) || '30d';
    const days = parseInt(range.replace('d', ''), 10) || 30;

    const rows = await sql`
      SELECT project, service, model,
        SUM(tokens_in) as tokens_in,
        SUM(tokens_out) as tokens_out,
        SUM(characters) as characters,
        COUNT(*) as requests
      FROM api_usage
      WHERE timestamp > NOW() - make_interval(days => ${days})
      GROUP BY project, service, model
      ORDER BY project, service
    `;

    // Aggregate by project with cost estimation
    const projectMap = new Map<string, {
      project: string;
      requests: number;
      tokensIn: number;
      tokensOut: number;
      characters: number;
      estimatedCost: number;
    }>();

    for (const row of rows) {
      const p = row.project as string;
      const existing = projectMap.get(p) || {
        project: p,
        requests: 0,
        tokensIn: 0,
        tokensOut: 0,
        characters: 0,
        estimatedCost: 0,
      };

      const tokensIn = Number(row.tokens_in);
      const tokensOut = Number(row.tokens_out);
      const characters = Number(row.characters);
      const requests = Number(row.requests);
      const model = row.model as string | null;
      const service = row.service as string;

      let cost = 0;
      if (service === 'anthropic' && model && PRICING[model]) {
        cost = (tokensIn * PRICING[model].inputPerM + tokensOut * PRICING[model].outputPerM) / 1_000_000;
      } else if (service === 'elevenlabs') {
        cost = (characters * ELEVENLABS_CHARS_PER_M) / 1_000_000;
      }

      existing.requests += requests;
      existing.tokensIn += tokensIn;
      existing.tokensOut += tokensOut;
      existing.characters += characters;
      existing.estimatedCost += cost;
      projectMap.set(p, existing);
    }

    const projects = Array.from(projectMap.values()).sort((a, b) => b.estimatedCost - a.estimatedCost);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ projects });
  } catch (error) {
    console.error('Portfolio summary error:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio summary' });
  }
}
