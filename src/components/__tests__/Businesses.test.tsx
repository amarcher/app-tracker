import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Businesses } from '../Businesses';
import type { BusinessStore, BusinessSummary, StoreName } from '../../types/business';

const store = (name: StoreName, recordedDownloads: number | null, recordedFromStart: boolean): BusinessStore => ({
  store: name, available: false, timeseries: [], downloads: null, latest: null, complete: false,
  reportingTimezone: 'UTC', recordedSince: recordedDownloads === null ? null : '2026-08-01', recordedDownloads, recordedFromStart,
});
const summary: BusinessSummary = {
  version: 1, generatedAt: '2026-09-22T00:00:00Z', range: { from: '2026-09-16', through: '2026-09-22', timezone: 'UTC' }, fable: null,
  apps: [
    { project: 'space-race', name: 'Space Race', stores: [store('apple', 28, true), store('amazon', 1, true), store('google', 0, true)] },
    { project: 'fable-designer', name: 'Fable Reader', stores: [store('apple', 12, true), store('amazon', 4, false), store('google', null, false)] },
    { project: 'crossword-clash', name: 'Crossword Clash', stores: [store('apple', 3, true), store('google', 5, true)] },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('Businesses all-time installs', () => {
  it('totals every platform only when each store’s history reaches release', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => summary }));
    render(<Businesses range="7d" refresh={0} />);
    const table = await screen.findByRole('table');
    const space = within(table).getByRole('row', { name: /Space Race/ });
    expect(within(space).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['28', '1', '0', '29']);
    const fable = within(table).getByRole('row', { name: /Fable Reader/ });
    expect(within(fable).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['12', '4*', '—', '—']);
    const crossword = within(table).getByRole('row', { name: /Crossword Clash/ });
    expect(within(crossword).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['3', 'Not listed', '5', '8']);
  });
});

describe('Businesses reels', () => {
  it('shows each brand’s Meta reels and why a platform is missing', async () => {
    const reel = { id: 'm1', platform: 'instagram' as const, title: 'Earth–Moon tides', url: 'https://instagram.com/reel/a', publishedAt: '2026-09-21T22:27:00Z', views: 1200, reach: 900, interactions: 40 };
    const social: BusinessSummary['social'] = [{ project: 'space-race', name: 'Space Race', platforms: [
      { platform: 'instagram', available: true, account: '@spacerace1000ly', reels: [reel], views: 1200, reach: 900, interactions: 40, viewsInRange: 300 },
      { platform: 'facebook', available: false, reason: 'Instagram and Facebook insights are awaiting connection.', reels: [], views: null, reach: null, interactions: null, viewsInRange: null },
    ] }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...summary, social }) }));
    render(<Businesses range="7d" refresh={0} />);
    expect(await screen.findByText('@spacerace1000ly', { exact: false })).toBeDefined();
    expect(screen.getByText('+300 in the last 7d')).toBeDefined();
    expect(screen.getByText('Instagram and Facebook insights are awaiting connection.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Earth–Moon tides' }).getAttribute('href')).toBe('https://instagram.com/reel/a');
  });
});

describe('Businesses Crossword Clash Plus', () => {
  it('shows who is paying now, what it is worth, and keeps test purchases out of the figures', async () => {
    const plus = { available: true, active: 14, byStore: { appStore: 9, googlePlay: 3, web: 2, other: 0 }, byPlan: { monthly: 10, annual: 4, unknown: 0 },
      cancelling: 1, newLast7Days: 2, newLast30Days: 5, mrrCents: 4823, grants: 2, test: { active: 3, newLast30Days: 1 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...summary, plus }) }));
    render(<Businesses range="7d" refresh={0} />);
    expect(await screen.findByRole('heading', { name: 'Crossword Clash Plus' })).toBeDefined();
    expect(screen.getByText('Subscribers').nextElementSibling?.textContent).toBe('14');
    expect(screen.getByText('9 App Store · 3 Google Play · 2 Web (Stripe)')).toBeDefined();
    expect(screen.getByText('Monthly revenue (est.)').nextElementSibling?.textContent).toBe('$48.23');
    expect(screen.getByText('10 monthly · 4 annual')).toBeDefined();
    expect(screen.getByText('2 in the last 7 days')).toBeDefined();
    expect(screen.getByText('Cancelling').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('2 complimentary grants')).toBeDefined();
    expect(screen.getByText('3 sandbox or test-mode subscriptions (1 new in 30 days), not counted')).toBeDefined();
  });

  it('says why the figures are missing instead of showing zeros', async () => {
    const plus = { available: false, reason: 'Crossword Clash Plus is awaiting its Supabase connection.', active: 0, byStore: { appStore: 0, googlePlay: 0, web: 0, other: 0 },
      byPlan: { monthly: 0, annual: 0, unknown: 0 }, cancelling: 0, newLast7Days: 0, newLast30Days: 0, mrrCents: 0, grants: 0, test: { active: 0, newLast30Days: 0 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...summary, plus }) }));
    render(<Businesses range="7d" refresh={0} />);
    expect(await screen.findByText('Crossword Clash Plus is awaiting its Supabase connection.')).toBeDefined();
    expect(screen.queryByText('Subscribers')).toBeNull();
  });
});
