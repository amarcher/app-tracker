import { afterEach, expect, it, vi } from 'vitest';
import { loadSocialReels, metaCredentials } from '../_shared/social-reels';
import { viewsGained } from '../_shared/business-data';
import type { SocialPlatformSummary } from '../../src/types/business';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('keeps each brand on its own Meta token', () => {
  const env = { SPACE_RACE_META_TOKEN: 'space', FABLE_META_TOKEN: 'fable', FABLE_META_PAGE_ID: '42' };
  expect(metaCredentials('space-race', env)).toEqual({ token: 'space', pageId: '1342569852267048' });
  expect(metaCredentials('fable-designer', env)).toEqual({ token: 'fable', pageId: '42' });
  expect(metaCredentials('fable-designer', {})).toEqual({ token: undefined, pageId: undefined });
});

it('waits for a token without calling Meta', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const platforms = await loadSocialReels('space-race');
  expect(platforms.map(p => [p.platform, p.available, p.reason])).toEqual([
    ['instagram', false, 'Instagram and Facebook insights are awaiting connection.'],
    ['facebook', false, 'Instagram and Facebook insights are awaiting connection.']]);
  expect(fetcher).not.toHaveBeenCalled();
});

it('reads reels with the Page token, tolerating a metric Meta does not report', async () => {
  vi.stubEnv('SPACE_RACE_META_TOKEN', 'system-user-token');
  const seen: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: URL) => {
    const url = new URL(input); seen.push(url);
    const path = url.pathname.replace('/v26.0/', ''), metric = url.searchParams.get('metric');
    if (path === '1342569852267048') return Response.json({ name: 'Space Race', access_token: 'page-token', instagram_business_account: { id: 'ig1', username: 'spacerace1000ly' } });
    if (path === 'ig1/media') return Response.json({ data: [
      { id: 'm1', caption: 'Tides\nmore', media_product_type: 'REELS', permalink: 'https://instagram.com/reel/a', timestamp: '2026-09-21T22:27:00+0000' },
      { id: 'm2', caption: 'A photo', media_product_type: 'FEED', timestamp: '2026-09-01T00:00:00+0000' }] });
    if (path === 'm1/insights') return metric === 'views' ? Response.json({ data: [{ values: [{ value: 1200 }] }] })
      : metric === 'reach' ? Response.json({ data: [{ total_value: { value: 900 } }] }) : new Response('{"error":"bad metric"}', { status: 400 });
    if (path === '1342569852267048/video_reels') return Response.json({ data: [{ id: 'f1', description: 'Tides', permalink_url: '/reel/1566663324662186/', created_time: '2026-09-21T22:26:00+0000' }] });
    if (path === 'f1/video_insights') return Response.json({ data: [{ values: [{ value: metric === 'blue_reels_play_count' ? 300 : 250 }] }] });
    throw new Error(`unexpected ${path}`);
  }));
  const [instagram, facebook] = await loadSocialReels('space-race');
  expect(instagram).toMatchObject({ available: true, account: '@spacerace1000ly', views: 1200, reach: 900, interactions: null });
  expect(instagram.reels).toEqual([expect.objectContaining({ id: 'm1', title: 'Tides', url: 'https://instagram.com/reel/a' })]);
  expect(facebook).toMatchObject({ available: true, account: 'Space Race', views: 300, reach: 250 });
  expect(facebook.reels[0].url).toBe('https://www.facebook.com/reel/1566663324662186/');
  expect(seen.slice(1).every(url => url.searchParams.get('access_token') === 'page-token')).toBe(true);
});

it('never returns Meta error bodies', async () => {
  vi.stubEnv('SPACE_RACE_META_TOKEN', 'expired');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"message":"token expired-secret"}}', { status: 401 })));
  const platforms = await loadSocialReels('space-race');
  expect(platforms[0].reason).toContain('Meta refused access');
  expect(JSON.stringify(platforms)).not.toContain('expired-secret');
});

it('counts views gained against the reading at the range start', () => {
  const summary = { platform: 'instagram', available: true, reach: null, interactions: null, views: 700, viewsInRange: null, reels: [
    { id: 'old', platform: 'instagram', title: '', url: null, publishedAt: '2026-09-01T00:00:00Z', views: 500, reach: null, interactions: null },
    { id: 'new', platform: 'instagram', title: '', url: null, publishedAt: '2026-09-20T00:00:00Z', views: 200, reach: null, interactions: null }],
  } satisfies SocialPlatformSummary;
  expect(viewsGained(summary, new Map([['old', 350]]), '2026-09-16')).toBe(350);
  expect(viewsGained(summary, new Map(), '2026-09-16')).toBeNull();
});
