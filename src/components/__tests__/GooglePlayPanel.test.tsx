import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GooglePlayPanel } from '../GooglePlayPanel';
import type { GooglePlayResponse } from '../../types';

const app = { name: 'Space Race: 1000 Light-Years', packageName: 'tech.spaceexplorer.spacerace' };

describe('GooglePlayPanel', () => {
  it('shows the reason when the app is not configured', () => {
    render(<GooglePlayPanel data={{ connected: false, reason: 'No Google Play app configured', app: null } as GooglePlayResponse} />);
    expect(screen.getByText('No Google Play app configured')).toBeDefined();
  });

  it('renders install cards and the chart when the export is available', () => {
    const data: GooglePlayResponse = {
      connected: true,
      app,
      installs: {
        available: true,
        timeseries: [
          { date: '2026-09-11', downloads: 2, deviceInstalls: 2, activeDeviceInstalls: 2, reportAvailable: true },
          { date: '2026-09-12', downloads: 3, deviceInstalls: 3, activeDeviceInstalls: 4, reportAvailable: true },
        ],
        totals: { userInstalls: 5, deviceInstalls: 5, latestDate: '2026-09-12', latestActiveDeviceInstalls: 4 },
      },
    };
    render(<GooglePlayPanel data={data} />);
    expect(screen.getByText('User installs')).toBeDefined();
    expect(screen.getByText('Device installs')).toBeDefined();
    expect(screen.getByText('Active device installs')).toBeDefined();
    expect(screen.getByText('as of 2026-09-12')).toBeDefined();
    expect(screen.getByText('Daily user installs')).toBeDefined();
  });

  it('degrades with the collector reason when the export is unavailable', () => {
    const data: GooglePlayResponse = {
      connected: true,
      app,
      installs: { available: false, reason: 'Google Play reporting access is awaiting connection.' },
    };
    render(<GooglePlayPanel data={data} />);
    expect(screen.getByText('Google Play reporting access is awaiting connection.')).toBeDefined();
    expect(screen.queryByText('Daily user installs')).toBeNull();
  });
});
