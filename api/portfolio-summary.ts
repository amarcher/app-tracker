import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

import { estimateCost, COST_SCOPE } from './_shared/usage-pricing.js';

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
      unpricedRequests: number;
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
        unpricedRequests: 0,
      };

      const tokensIn = Number(row.tokens_in);
      const tokensOut = Number(row.tokens_out);
      const characters = Number(row.characters);
      const requests = Number(row.requests);
      const model = row.model as string | null;
      const service = row.service as string;

      const cost = estimateCost(service, model, tokensIn, tokensOut);
      if (cost === null) existing.unpricedRequests += requests;

      existing.requests += requests;
      existing.tokensIn += tokensIn;
      existing.tokensOut += tokensOut;
      existing.characters += characters;
      existing.estimatedCost += cost ?? 0;
      projectMap.set(p, existing);
    }

    const projects = Array.from(projectMap.values()).sort((a, b) => b.estimatedCost - a.estimatedCost);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ projects, costScope: COST_SCOPE });
  } catch (error) {
    console.error('Portfolio summary error:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio summary' });
  }
}
