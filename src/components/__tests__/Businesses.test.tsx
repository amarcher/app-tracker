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
