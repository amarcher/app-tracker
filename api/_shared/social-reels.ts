import type { ReelStat, SocialPlatform, SocialPlatformSummary } from '../../src/types/business.js';

const GRAPH = 'https://graph.facebook.com/v26.0';
const MAX_REELS = 50;

/** Public account identities; tokens live in `<metaPrefix>_TOKEN` (a system-user or long-lived user token with
 * pages_show_list, pages_read_engagement, read_insights, instagram_basic, instagram_manage_insights). */
export const SOCIAL_ACCOUNTS: Record<string, { name: string; metaPrefix: string; pageId?: string }> = {
  'space-race': { name: 'Space Race', metaPrefix: 'SPACE_RACE_META', pageId: '1342569852267048' },
  'fable-designer': { name: 'Fable Designer', metaPrefix: 'FABLE_META' },
};

export function metaCredentials(project: string, env = process.env) {
  const account = SOCIAL_ACCOUNTS[project];
  return { token: account ? env[`${account.metaPrefix}_TOKEN`] : undefined,
    pageId: account ? env[`${account.metaPrefix}_PAGE_ID`] || account.pageId : undefined };
}

async function graph(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [key, value] of Object.entries({ ...params, access_token: token })) url.searchParams.set(key, value);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  // Graph error bodies can echo the token; never surface them.
  if (response.status === 400 || response.status === 401 || response.status === 403) throw new Error('meta_access');
  if (!response.ok) throw new Error('meta_unavailable');
  return response.json();
}

/** Insight requests fail whole when one metric is unsupported for a media, so ask per metric. */
async function lifetimeMetrics(path: string, token: string, metrics: string[]): Promise<Record<string, number | null>> {
  const entries = await Promise.all(metrics.map(async metric => {
    try {
      const data = await graph(path, token, { metric, period: 'lifetime' });
      const row = data?.data?.[0];
      const value = row?.total_value?.value ?? row?.values?.[0]?.value;
      return [metric, Number.isSafeInteger(value) ? value : null] as const;
    } catch { return [metric, null] as const; }
  }));
  return Object.fromEntries(entries);
}

const sum = (reels: ReelStat[], key: 'views' | 'reach' | 'interactions') =>
  reels.some(reel => reel[key] !== null) ? reels.reduce((total, reel) => total + (reel[key] ?? 0), 0) : null;

function summary(platform: SocialPlatform, account: string | undefined, reels: ReelStat[]): SocialPlatformSummary {
  reels.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { platform, available: true, account, reels, views: sum(reels, 'views'), reach: sum(reels, 'reach'),
    interactions: sum(reels, 'interactions'), viewsInRange: null };
}

const title = (text: unknown) => typeof text === 'string' && text.trim() ? text.trim().split('\n')[0].slice(0, 90) : 'Untitled reel';

async function instagramReels(igId: string, username: string | undefined, token: string) {
  const media = await graph(`${igId}/media`, token, { fields: 'id,caption,media_product_type,permalink,timestamp', limit: String(MAX_REELS) });
  const reels: ReelStat[] = await Promise.all((media.data ?? []).filter((item: { media_product_type?: string }) => item.media_product_type === 'REELS')
    .map(async (item: { id: string; caption?: string; permalink?: string; timestamp: string }) => {
      const m = await lifetimeMetrics(`${item.id}/insights`, token, ['views', 'reach', 'total_interactions']);
      return { id: item.id, platform: 'instagram' as const, title: title(item.caption), url: item.permalink ?? null,
        publishedAt: item.timestamp, views: m.views, reach: m.reach, interactions: m.total_interactions };
    }));
  return summary('instagram', username ? `@${username}` : undefined, reels);
}

async function facebookReels(pageId: string, pageName: string | undefined, token: string) {
  const list = await graph(`${pageId}/video_reels`, token, { fields: 'id,description,permalink_url,created_time', limit: String(MAX_REELS) });
  const reels: ReelStat[] = await Promise.all((list.data ?? []).map(async (item: { id: string; description?: string; permalink_url?: string; created_time: string }) => {
    // Facebook's reel "plays" is the figure Meta labels Views in Page insights; reach is unique accounts.
    const m = await lifetimeMetrics(`${item.id}/video_insights`, token, ['blue_reels_play_count', 'post_impressions_unique', 'post_video_social_actions']);
    return { id: item.id, platform: 'facebook' as const, title: title(item.description),
      url: item.permalink_url ? new URL(item.permalink_url, 'https://www.facebook.com').href : null,
      publishedAt: item.created_time, views: m.blue_reels_play_count, reach: m.post_impressions_unique, interactions: m.post_video_social_actions };
  }));
  return summary('facebook', pageName, reels);
}

export async function loadSocialReels(project: string): Promise<SocialPlatformSummary[]> {
  const unavailable = (reason: string): SocialPlatformSummary[] => (['instagram', 'facebook'] as const).map(platform =>
    ({ platform, available: false, reason, reels: [], views: null, reach: null, interactions: null, viewsInRange: null }));
  const { token, pageId } = metaCredentials(project);
  if (!SOCIAL_ACCOUNTS[project]) return unavailable('No social accounts are configured for this brand.');
  if (!token) return unavailable('Instagram and Facebook insights are awaiting connection.');
  if (!pageId || !/^\d+$/.test(pageId)) return unavailable('The Facebook Page for this brand needs to be set.');
  try {
    // A Page token is required for Page and reel insights; a system-user token can mint it.
    const page = await graph(pageId, token, { fields: 'name,access_token,instagram_business_account{id,username}' });
    const pageToken = typeof page.access_token === 'string' ? page.access_token : token;
    const ig = page.instagram_business_account;
    const [instagram, facebook] = await Promise.allSettled([
      ig?.id ? instagramReels(ig.id, ig.username, pageToken) : Promise.reject(new Error('meta_no_instagram')),
      facebookReels(pageId, page.name, pageToken),
    ]);
    const settle = (platform: SocialPlatform, result: PromiseSettledResult<SocialPlatformSummary>): SocialPlatformSummary =>
      result.status === 'fulfilled' ? result.value : { ...unavailable('')[0], platform,
        reason: result.reason?.message === 'meta_no_instagram' ? 'No Instagram professional account is linked to this Facebook Page.'
          : result.reason?.message === 'meta_access' ? 'Meta refused access. Check the token’s insights permissions.' : 'Meta insights are temporarily unavailable.' };
    return [settle('instagram', instagram), settle('facebook', facebook)];
  } catch (error) {
    return unavailable(error instanceof Error && error.message === 'meta_access'
      ? 'Meta refused access to this Page. The token may have expired or lack Page permissions.'
      : 'Meta insights are temporarily unavailable.');
  }
}
