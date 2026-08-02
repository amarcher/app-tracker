#!/usr/bin/env node
/**
 * One-time opt-in for App Store Connect Analytics Reports.
 *
 * Apple only generates the analytics reports that back the dashboard's "Daily
 * Active Devices" metric after an app is opted in via POST
 * /v1/analyticsReportRequests. That POST requires an ADMIN-role API key — a
 * Sales and Reports key can read the resulting reports but gets a 403 here.
 *
 * Creates two requests per app:
 *   ONGOING           — refreshed daily, feeds the dashboard from now on
 *   ONE_TIME_SNAPSHOT — backfills up to a year of history
 *
 * Reports appear within ~48h. Run `--list` afterwards to check.
 *
 * Usage:
 *   ASC_ADMIN_KEY_ID=XXXX ASC_ISSUER_ID=yyyy node scripts/asc-analytics-request.mjs <appId>
 *   node scripts/asc-analytics-request.mjs <appId> --list
 *
 * The private key is read from ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
 * (or ASC_ADMIN_PRIVATE_KEY_PATH). Never copy a .p8 into this repo.
 */
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const appId = process.argv.find((a) => /^\d+$/.test(a));
const listOnly = process.argv.includes('--list');
const keyId = process.env.ASC_ADMIN_KEY_ID ?? process.env.ASC_API_KEY_ID;
const issuerId = process.env.ASC_ISSUER_ID ?? process.env.ASC_API_ISSUER_ID;
const keyPath = process.env.ASC_ADMIN_PRIVATE_KEY_PATH
  ?? `${homedir()}/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`;

if (!appId || !keyId || !issuerId) {
  console.error('Usage: ASC_ADMIN_KEY_ID=... ASC_ISSUER_ID=... node scripts/asc-analytics-request.mjs <appId> [--list]');
  process.exit(1);
}

const b64 = (input) => Buffer.from(input).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
const payload = b64(JSON.stringify({ iss: issuerId, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
  key: createPrivateKey(readFileSync(keyPath, 'utf8')),
  dsaEncoding: 'ieee-p1363',
});
const token = `${header}.${payload}.${b64(signature)}`;

async function api(path, init = {}) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { status: res.status, json, text };
}

if (!listOnly) {
  for (const accessType of ['ONGOING', 'ONE_TIME_SNAPSHOT']) {
    const created = await api('/v1/analyticsReportRequests', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'analyticsReportRequests',
          attributes: { accessType },
          relationships: { app: { data: { type: 'apps', id: appId } } },
        },
      }),
    });
    if (created.status === 201) {
      console.log(`created ${accessType}: ${created.json.data.id}`);
    } else if (created.status === 409) {
      console.log(`${accessType}: already exists`);
    } else {
      console.error(`${accessType}: ${created.status} ${created.text.slice(0, 400)}`);
      if (created.status === 403) {
        console.error('  → this endpoint needs an ADMIN-role App Store Connect API key');
      }
    }
  }
}

const requests = await api(`/v1/apps/${appId}/analyticsReportRequests?limit=50`);
for (const request of requests.json?.data ?? []) {
  const { accessType, stoppedDueToInactivity } = request.attributes;
  console.log(`\n${request.id}  ${accessType}${stoppedDueToInactivity ? '  (STOPPED — inactive)' : ''}`);
  const reports = await api(`/v1/analyticsReportRequests/${request.id}/reports?limit=200`);
  const names = (reports.json?.data ?? []).map((r) => `  [${r.attributes.category}] ${r.attributes.name}`);
  console.log(names.length > 0 ? names.join('\n') : '  no reports generated yet (allow ~48h)');
}
