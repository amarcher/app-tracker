import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AmazonAppstorePanel } from '../AmazonAppstorePanel';
import type { AmazonAppstoreResponse } from '../../types';

const app = { name: 'Space Race: 1000 Light Years', packageName: 'tech.spaceexplorer.spacerace', asin: null };

describe('AmazonAppstorePanel', () => {
  it('shows the reason when the app is not configured', () => {
    render(<AmazonAppstorePanel data={{ connected: false, reason: 'No Amazon Appstore app configured', app: null } as AmazonAppstoreResponse} />);
    expect(screen.getByText('No Amazon Appstore app configured')).toBeDefined();
  });

  it('renders downloads and active users when both sources are available', () => {
    const data: AmazonAppstoreResponse = {
      connected: true,
      app,
      downloads: {
        available: true,
        timeseries: [{ date: '2026-08-08', downloads: 2 }, { date: '2026-08-09', downloads: 3 }],
        totals: { downloads: 5 },
      },
      stats: {
        available: true,
        timeseries: [
          { date: '2026-08-08', installs: 2, installEvents: 2, currentInstalls: 9, dau: 4, wau: 6, mau: 8 },
          { date: '2026-08-09', installs: 1, installEvents: 1, currentInstalls: 10, dau: 5, wau: 7, mau: 9 },
        ],
        totals: {
          installs: 3, currentInstalls: 10, latestDate: '2026-08-09',
          latestDau: 5, latestWau: 7, latestMau: 9, avgDau: 5, peakDau: 5,
        },
      },
    };
    render(<AmazonAppstorePanel data={data} />);
    // "Downloads" labels both the metric card and the chart below it.
    expect(screen.getAllByText('Downloads')).toHaveLength(2);
    expect(screen.getByText('in range · sales units')).toBeDefined();
    expect(screen.getByText('Daily Active Users')).toBeDefined();
    expect(screen.getByText('2026-08-09 · avg 5, peak 5')).toBeDefined();
    expect(screen.getByText('devices with the app installed')).toBeDefined();
  });

  it('degrades each source independently with its reason', () => {
    const data: AmazonAppstoreResponse = {
      connected: true,
      app,
      downloads: { available: false, reason: 'AMAZON_REPORTING_CLIENT_ID/SECRET not configured' },
      stats: { available: false, reason: 'No ingested Amazon reports yet' },
    };
    render(<AmazonAppstorePanel data={data} />);
    expect(screen.getByText('AMAZON_REPORTING_CLIENT_ID/SECRET not configured')).toBeDefined();
    expect(screen.getByText('No ingested Amazon reports yet')).toBeDefined();
  });
});
