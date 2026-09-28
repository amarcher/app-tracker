import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { creditAlertConnectedMessage, creditAlertMessage, creditBand, type CreditBand, type Subscription } from './_shared/credit-alert.js';

const STATE_KEY = 'elevenlabs_credit_band';

/**
 * Hourly (vercel.json cron): post to Slack only when ElevenLabs credit moves
 * between ok / low / out. The last band is kept in Neon so the channel hears
 * about each change once, not every hour.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) return res.status(401).end();
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const webhook = process.env.SLACK_ALERTS_WEBHOOK_URL?.trim();
  if (!apiKey || !databaseUrl) return res.status(500).json({ error: 'Credit alert is not configured' });

  const subRes = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': apiKey } });
  if (!subRes.ok) {
    console.error(`credit-alert: ElevenLabs ${subRes.status}`);
    return res.status(502).json({ error: 'ElevenLabs subscription unavailable' });
  }
  const sub = (await subRes.json()) as Subscription;
  const lowFraction = Number(process.env.ELEVENLABS_LOW_CREDIT_FRACTION?.trim()) || undefined;
  const current = creditBand(sub, lowFraction);

  const db = neon(databaseUrl);
  await db`CREATE TABLE IF NOT EXISTS alert_state (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  const rows = await db`SELECT value FROM alert_state WHERE key = ${STATE_KEY}`;
  const stored = rows[0]?.value as CreditBand | undefined;
  const previous = stored ?? 'ok';
  // First run with Slack configured: say so once, then report band changes only.
  const text = stored === undefined ? creditAlertConnectedMessage(current, sub) : creditAlertMessage(previous, current, sub);

  if (text) {
    // Without a webhook, keep the old band so the alert still fires once one is configured.
    if (!webhook) return res.json({ previous, current, notified: false, reason: 'SLACK_ALERTS_WEBHOOK_URL not set' });
    const slack = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!slack.ok) {
      console.error(`credit-alert: Slack ${slack.status}`);
      return res.status(502).json({ previous, current, notified: false, reason: `Slack ${slack.status}` });
    }
  }
  await db`INSERT INTO alert_state (key, value, updated_at) VALUES (${STATE_KEY}, ${current}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  return res.json({ previous, current, notified: !!text });
}
