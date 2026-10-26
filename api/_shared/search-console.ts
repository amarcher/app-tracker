import { GoogleAuth } from 'google-auth-library';
import { PROJECTS } from '../../src/config/projects.js';

const env = (name: string) => (process.env[name] ?? '').trim();

export const PROJECT_DOMAINS: Record<string, string> = Object.fromEntries(PROJECTS.map(p => [p.value, p.domain]));

const SITE_URL_ENV: Record<string, string> = {
  'animal-penpals': env('GSC_SITE_URL_ANIMAL_PENPALS'),
  'space-explorer': env('GSC_SITE_URL_SPACE_EXPLORER'),
  'space-race': env('GSC_SITE_URL_SPACE_RACE'),
  'periodic-table': env('GSC_SITE_URL_PERIODIC_TABLE'),
  'crossword-clash': env('GSC_SITE_URL_CROSSWORD_CLASH'),
  'ticket-for-dinner': env('GSC_SITE_URL_TICKET_FOR_DINNER'),
  'superbowl-squares': env('GSC_SITE_URL_SUPERBOWL_SQUARES'),
  'tabbit-rabbit': env('GSC_SITE_URL_TABBIT_RABBIT'),
  'mark-my-words': env('GSC_SITE_URL_MARK_MY_WORDS'),
  'mtg-dash': env('GSC_SITE_URL_MTG_DASH'),
  'recipe-guide': env('GSC_SITE_URL_RECIPE_GUIDE'),
  'fable-designer': env('GSC_SITE_URL_FABLE_DESIGNER'),
};

export interface SearchConsoleSiteEntry {
  siteUrl: string;
  permissionLevel?: string;
}

export interface SearchAnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API_BASE = 'https://www.googleapis.com/webmasters/v3';

function getAuth() {
  const keyJson = env('GA4_KEY_JSON');
  if (keyJson) {
    return new GoogleAuth({
      credentials: JSON.parse(keyJson),
      scopes: [SEARCH_CONSOLE_SCOPE],
    });
  }

  const keyFile = env('GOOGLE_APPLICATION_CREDENTIALS');
  return new GoogleAuth({
    keyFilename: keyFile || undefined,
    scopes: [SEARCH_CONSOLE_SCOPE],
  });
}

async function accessToken(): Promise<string> {
  const token = await getAuth().getAccessToken();
  if (!token) throw new Error('Unable to get Google API access token');
  return token;
}

async function googleRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Search Console API ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

export async function listSearchConsoleSites(): Promise<SearchConsoleSiteEntry[]> {
  const body = await googleRequest<{ siteEntry?: SearchConsoleSiteEntry[] }>(`${API_BASE}/sites`);
  return body.siteEntry ?? [];
}

export async function querySearchAnalytics(
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<SearchAnalyticsRow[]> {
  const url = `${API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await googleRequest<{ rows?: SearchAnalyticsRow[] }>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.rows ?? [];
}

function hostFromSiteUrl(siteUrl: string): string | null {
  if (siteUrl.startsWith('sc-domain:')) return siteUrl.replace('sc-domain:', '').toLowerCase();
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function baseDomain(domain: string): string {
  return domain.replace(/^www\./, '').toLowerCase();
}

export function findSiteForProject(
  project: string,
  sites: SearchConsoleSiteEntry[],
): SearchConsoleSiteEntry | null {
  const explicit = SITE_URL_ENV[project];
  if (explicit) {
    return sites.find((s) => s.siteUrl === explicit) ?? { siteUrl: explicit, permissionLevel: 'configured' };
  }

  const domain = PROJECT_DOMAINS[project];
  if (!domain) return null;

  const normalized = baseDomain(domain);
  const exactDomainProperty = sites.find((s) => s.siteUrl === `sc-domain:${normalized}`);
  if (exactDomainProperty) return exactDomainProperty;

  const urlProperty = sites.find((s) => !s.siteUrl.startsWith('sc-domain:') && hostFromSiteUrl(s.siteUrl) === normalized);
  if (urlProperty) return urlProperty;

  // Only accessible domain properties that actually contain this hostname.
  return sites.filter(s => s.siteUrl.startsWith('sc-domain:') && normalized.endsWith(`.${s.siteUrl.slice(10)}`))
    .sort((a, b) => b.siteUrl.length - a.siteUrl.length)[0] ?? null;
}

export function dateRangeForSearchConsole(days: number): { startDate: string; endDate: string } {
  // Search Console data is usually delayed. Ending two days ago avoids showing
  // a partial current day as a false decline.
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(days - 1, 0));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/** Apply the same hostname scope to totals, breakdowns and coverage surveys. */
export async function queryProjectSearchAnalytics(project: string, siteUrl: string, body: Record<string, unknown>): Promise<SearchAnalyticsRow[]> {
  const domain = PROJECT_DOMAINS[project];
  if (!domain) throw new Error('No Search Console domain configured for project');
  const escapedHost = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return querySearchAnalytics(siteUrl, {
    ...body,
    dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: `^https?://(www\\.)?${escapedHost}/` }] }],
  });
}
