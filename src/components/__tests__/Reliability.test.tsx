import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HomeOverview } from '../HomeOverview';
import { CostCoverage, formatEstimatedCost } from '../CostCoverage';
import { SearchConsoleSurvey } from '../SearchConsoleSurvey';
import App from '../../App';
const totals = { users: 9, sessions: 12, pageviews: 20, newUsers: 2, engagementRate: 0.5, avgSessionDuration: 30 };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('exposes excluded traffic sources and avoids a false comparison', () => {
  render(<HomeOverview data={{ range: '30d', projects: [{ project: 'good', current: totals, previous: null, usersChangePct: null, pageviewsChangePct: null }], unavailable: [{ project: 'missing', reason: 'No GA4 property configured' }], comparisonUnavailable: ['good'], note: 'Includes today; today is partial.' }} projectLabels={{ missing: 'Missing Project' }} onSelectProject={() => {}} />);
  expect(screen.getByText(/Partial coverage/).textContent).toContain('1 of 2 projects available');
  expect(screen.getByText('Missing Project: No GA4 property configured').textContent).toBe('Missing Project: No GA4 property configured');
  expect(screen.getByText(/Prior-period data unavailable/).textContent).toContain('Aggregate change is unavailable');
  expect(screen.getByText(/Includes today/).textContent).toContain('today is partial');
  expect(screen.queryByText(/▲/)).toBeNull();
});
it('distinguishes an unpriced total from free usage and labels partial estimates', () => {
  expect(formatEstimatedCost(0, 2, 2)).toBe('Unpriced');
  expect(formatEstimatedCost(0.75, 5, 3)).toBe('$0.750 + unpriced');
  expect(formatEstimatedCost(0, 2, 0)).toBe('$0.0000');
  render(<CostCoverage unpricedRequests={3} unpricedUsage={[{ service: 'openai', model: 'future-model', requests: 3 }]} />);
  expect(screen.getByRole('status').textContent).toContain('3 logged requests have no supported price');
  expect(screen.getByText(/openai \/ future-model/).textContent).toContain('3 unpriced requests');
});
it('shows missing Search Console values as unavailable, not zero', () => {
  render(<SearchConsoleSurvey projectLabels={{}} data={{ dateRange: { startDate: '2026-10-01', endDate: '2026-10-24' }, sites: [], projects: [{ project: 'fable-designer', domain: 'fabledesigner.com', status: 'missing-property', siteUrl: null, clicks: 0, impressions: 0 }] }} />);
  expect(screen.getByText('fable-designer').closest('tr')?.textContent).toBe('fable-designerfabledesigner.comMissing———');
});
it('shows a portfolio fetch failure instead of silently claiming no usage', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: !url.includes('portfolio-summary'), json: async () => ({ projects: [], range: '1d' }) })));
  render(<App />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '__portfolio__' } });
  await waitFor(() => expect(screen.getByText('Failed to fetch portfolio data').textContent).toBe('Failed to fetch portfolio data'));
});
it('does not display zero traffic when every source is unavailable', () => {
  const { container } = render(<HomeOverview data={{ range: '30d', projects: [], unavailable: [{ project: 'missing', reason: 'Traffic query failed' }] }} projectLabels={{}} onSelectProject={() => {}} />);
  expect(screen.getByText(/Partial coverage/).textContent).toContain('0 of 1 projects available');
  expect(Array.from(container.querySelectorAll('.metric-value')).map(el => el.textContent).slice(0, 4)).toEqual(['—', '—', '—', '—']);
});
