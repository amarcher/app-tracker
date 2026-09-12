import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';

const COOKIE = 'business_session';
export function verifyTicket(ticket: string, purpose: string, secret: string, now = Date.now()): boolean {
  try {
    if (secret.length < 32 || ticket.length > 1024) return false;
    const [payload, signature, extra] = ticket.split('.');
    if (!payload || !signature || extra) return false;
    const expected = createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.purpose === purpose && Number.isSafeInteger(data.exp) && data.exp > now / 1000;
  } catch { return false; }
}
export function sessionCookie(secret: string): string {
  const payload = Buffer.from(JSON.stringify({ purpose: 'business-session', exp: Math.floor(Date.now() / 1000) + 7 * 86400 })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${COOKIE}=${payload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=604800`;
}
export function businessAccess(req: VercelRequest, secret = process.env.BUSINESS_METRICS_TOKEN): boolean {
  if (!secret || secret.length < 32) return false;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const hash = (value: string) => createHash('sha256').update(value).digest();
    if (timingSafeEqual(hash(auth.slice(7)), hash(secret))) return true;
  }
  const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
  return cookie ? verifyTicket(cookie.slice(COOKIE.length + 1), 'business-session', secret) : false;
}
