import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { GooglePlayResponse } from '../types';
import { MetricCard } from './MetricCard';

function formatDay(dateStr: string): string {
  return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}`;
}

interface GooglePlayPanelProps {
  data: GooglePlayResponse | null;
}

export function GooglePlayPanel({ data }: GooglePlayPanelProps) {
  if (!data || !data.connected || !data.app) {
    return <div className="loading">{data?.reason || 'No Google Play data available.'}</div>;
  }

  const { installs } = data;

  return (
    <>
      <div className="metrics-row">
        {installs.available ? (
          <>
            <MetricCard label="User installs" value={installs.totals.userInstalls} subtitle="in range · daily user installs" />
            <MetricCard
              label="Device installs"
              value={installs.totals.deviceInstalls ?? '—'}
              subtitle={installs.totals.deviceInstalls === null ? 'not reported for every day' : 'in range'}
            />
            <MetricCard
              label="Active device installs"
              value={installs.totals.latestActiveDeviceInstalls ?? '—'}
              subtitle={`as of ${installs.totals.latestDate}`}
            />
          </>
        ) : (
          <MetricCard label="User installs" value="—" subtitle={installs.reason} />
        )}
      </div>

      {installs.available && installs.timeseries.length > 1 && (
        <div className="chart-container">
          <h3>Daily user installs</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={installs.timeseries.map((d) => ({ ...d, label: formatDay(d.date) }))}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradient-play-installs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#01875f" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#01875f" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
              <XAxis dataKey="label" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e1e2e',
                  border: '1px solid #3a3a5e',
                  borderRadius: '8px',
                  color: '#e2e8f0',
                }}
                formatter={(value) => [Number(value).toLocaleString(), 'User installs']}
              />
              <Area
                type="monotone"
                dataKey="downloads"
                stroke="#01875f"
                strokeWidth={2}
                fill="url(#gradient-play-installs)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="panel-note">
        Numbers come from the Play Console country export in Cloud Storage
        (<code>stats/installs/…_country.csv</code>, summed across countries), which Google publishes three to
        seven days late — days it has not published yet are left out rather than shown as zero. These are
        installs, not launches: the child-directed Play build ships no analytics, so there is no DAU here.
      </p>
    </>
  );
}
