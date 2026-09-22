import { GoogleAuth } from 'google-auth-library';
import { parseCsv, pick } from '../amazon-appstore.js';
import { mapBounded, STORE_APPS } from './store-apps.js';
import type { StoreDay } from '../../src/types/business.js';

// Google publishes daily statistics in monthly UTF-16 CSVs, usually 3–7 days late.
// https://support.google.com/googleplay/android-developer/answer/6135870
const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';
const DAY = 86400_000;
const MAX_REPORT_BYTES = 8 * 1024 * 1024;

export function googlePlayCredentials(project: string, env = process.env) {
  const prefix = STORE_APPS[project]?.googlePrefix;
  return { keyJson: prefix ? env[`${prefix}_KEY_JSON`] : undefined,
    bucket: prefix ? env[`${prefix}_REPORT_BUCKET`] : undefined };
}

function count(value: string | undefined): number | null {
  if (value === undefined || value === '' || /^(?:N\/A|[-—*]|<\s*\d+)$/i.test(value)) return null;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid Google Play count');
  return Number(value);
}

export function decodeGooglePlayCsv(buffer: Buffer): string {
  const encoding = buffer[0] === 0xfe && buffer[1] === 0xff ? 'utf-16be'
    : buffer[0] === 0xff && buffer[1] === 0xfe || buffer[1] === 0 ? 'utf-16le' : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
}

/** Only the country export is read: summing several dimensions would count installs twice.
 * A suppressed country makes that day's total unavailable. Gauges use the latest day. */
export function parseGooglePlayInstalls(csv: string, packageName: string, month: string): StoreDay[] {
  const days = new Map<string, { installs: number | null; devices: number | null; active: number | null; updates: number | null }>();
  const seen = new Set<string>();
  for (const row of parseCsv(csv)) {
    const date = pick(row, 'Date') ?? '';
    if (pick(row, 'Package Name') !== packageName) throw new Error('Google Play package mismatch');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date
      || date.slice(0, 7).replace('-', '') !== month) throw new Error('Invalid Google Play report date');
    const country = pick(row, 'Country');
    if (country === undefined) throw new Error('Expected the Google Play country report');
    const key = `${date}:${country}`;
    if (seen.has(key)) throw new Error('Duplicate Google Play country row');
    seen.add(key);
    const values = {
      installs: count(pick(row, 'Daily User Installs')),
      devices: count(pick(row, 'Daily Device Installs')),
      active: count(pick(row, 'Installs on active devices', 'Active Device Installs')),
      updates: count(pick(row, 'Daily Device Upgrades')),
    };
    const total = days.get(date) ?? { installs: 0, devices: 0, active: 0, updates: 0 };
    for (const metric of ['installs', 'devices', 'active', 'updates'] as const) {
      const a = total[metric], b = values[metric];
      total[metric] = a === null || b === null ? null : a + b;
      if (total[metric] !== null && !Number.isSafeInteger(total[metric])) throw new Error('Google Play count overflow');
    }
    days.set(date, total);
  }
  return [...days].filter(([, day]) => day.installs !== null).map(([date, day]) => ({ date,
    downloads: day.installs!, deviceInstalls: day.devices, activeDeviceInstalls: day.active,
    ...(day.updates === null ? {} : { updates: day.updates }), reportAvailable: true,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadGooglePlay(project: string, range: string) {
  const unavailable = (connectionReason: string) => ({ downloads: { available: false, timeseries: [] as StoreDay[] }, connectionReason });
  const app = STORE_APPS[project];
  const { keyJson, bucket } = googlePlayCredentials(project);
  if (!app?.googlePrefix) return unavailable('Google Play reporting is not configured for this app.');
  if (!keyJson) return unavailable('Google Play reporting access is awaiting connection.');
  if (!bucket) return unavailable('Waiting for Google Play to provide its report export location.');
  if (!/^pubsite_prod_(?:rev_)?\d+$/.test(bucket)) return unavailable('The Google Play report export location needs checking.');
  const days = Number(range.replace(/d$/, ''));
  if (![1, 7, 30, 90].includes(days)) throw new Error('Unsupported Google Play date range');
  const now = Date.now();
  const dates = Array.from({ length: days }, (_, index) => new Date(now + (index - days) * DAY).toISOString().slice(0, 10));
  const months = [...new Set(dates.map(date => date.slice(0, 7).replace('-', '')))];
  try {
    const credentials = JSON.parse(keyJson);
    if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) return unavailable('The Google Play reporting credential needs checking.');
    const token = await new GoogleAuth({ credentials, scopes: [SCOPE] }).getAccessToken();
    if (!token) return unavailable('Google Play reporting could not sign in.');
    // List before reading: without list access a missing object also answers 403, so "no reports yet" would read as "denied".
    const prefix = `stats/installs/installs_${app.packageName}_`;
    const listing = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}&fields=items(name)`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (listing.status === 401 || listing.status === 403 || listing.status === 404) throw new Error('report_access');
    if (!listing.ok) throw new Error('report_unavailable');
    const exported = new Set(((await listing.json()).items ?? []).map((item: { name: string }) => item.name));
    if (!exported.size) return unavailable('Google Play has not exported any install reports for this app yet. Play creates one after the first month with installs.');
    const reports = await mapBounded(months, async month => {
      const object = `${prefix}${month}_country.csv`;
      if (!exported.has(object)) return [];
      const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      if (response.status === 404) return [];
      if (response.status === 401 || response.status === 403) throw new Error('report_access');
      if (!response.ok) throw new Error('report_unavailable');
      if (Number(response.headers.get('content-length')) > MAX_REPORT_BYTES) throw new Error('report_size');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_REPORT_BYTES) throw new Error('report_size');
      return parseGooglePlayInstalls(decodeGooglePlayCsv(buffer), app.packageName, month);
    });
    const timeseries = reports.flat().filter(row => dates.includes(row.date));
    return { downloads: { available: timeseries.length > 0, timeseries },
      connectionReason: timeseries.length ? undefined : 'Google Play has not provided install reports for this period yet. Exports usually arrive 3–7 days later.' };
  } catch (error) {
    // Authentication errors may include credentials. Keep provider error bodies out of responses and logs.
    return unavailable(error instanceof Error && error.message === 'report_access'
      ? 'Google Play denied access to this report export. Check the reporting-only permission.'
      : 'Google Play reporting is temporarily unavailable. The last recorded history is retained.');
  }
}
