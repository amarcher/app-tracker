import type { VercelRequest, VercelResponse } from '@vercel/node';
import { businessAccess } from './_shared/business-access.js';
import { loadCrosswordGameplay } from './_shared/crossword-gameplay.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!businessAccess(req)) return res.status(401).json({ error: 'Open Our businesses from Fable admin to sign in.' });
  if (req.method !== 'GET') return res.status(405).end();
  const range = req.query.range ?? '7d';
  if (typeof range !== 'string' || !['1d', '7d', '30d', '90d'].includes(range)) return res.status(400).json({ error: 'Choose 1, 7, 30, or 90 days.' });
  const report = await loadCrosswordGameplay(Number(range.slice(0, -1)));
  return res.status(report.available ? 200 : 503).json(report);
}
