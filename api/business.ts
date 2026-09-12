import type { VercelRequest, VercelResponse } from '@vercel/node';
import { businessAccess, sessionCookie, verifyTicket } from './_shared/business-access.js';
import { cachedBusiness, collectBusiness, ensureBusinessStorage } from './_shared/business-data.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const secret = process.env.BUSINESS_METRICS_TOKEN;
  if (req.query.action === 'session') {
    if (req.method !== 'POST') return res.status(405).end();
    const ticket = typeof req.body === 'string' ? new URLSearchParams(req.body).get('ticket') : req.body?.ticket;
    if (!secret || typeof ticket !== 'string' || !verifyTicket(ticket, 'business-handoff', secret)) return res.status(401).json({ error: 'Open this dashboard from Fable admin to sign in.' });
    res.setHeader('Set-Cookie', sessionCookie(secret));
    return res.redirect(303, '/?view=businesses');
  }
  const cron = req.query.action === 'sync' && process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron && !businessAccess(req)) return res.status(401).json({ error: 'Open Our businesses from Fable admin.' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  const days = Number(String(req.query.range || '7d').replace('d', ''));
  if (![1, 7, 30, 90].includes(days)) return res.status(400).json({ error: 'Choose 1, 7, 30, or 90 days.' });
  const cached = await cachedBusiness(days);
  if (req.query.action === 'household') {
    if (!cached) return res.status(503).json({ error: 'The first business report is being prepared.' });
    return res.json({ ...cached, stale: Date.now() - Date.parse(cached.generatedAt) > 75 * 60_000 });
  }
  if (req.query.action !== 'sync' && cached && Date.now() - Date.parse(cached.generatedAt) < 15 * 60_000) return res.json(cached);
  try {
    await ensureBusinessStorage();
    const result = await collectBusiness(days, true);
    if (!result.fable && cached) return res.json({ ...cached, stale: true });
    return res.json(result);
  } catch {
    if (cached) return res.json({ ...cached, stale: true });
    return res.status(503).json({ error: 'Business figures are temporarily unavailable.' });
  }
}
