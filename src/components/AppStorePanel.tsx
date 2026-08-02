import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { AppStoreResponse } from '../types';
import { MetricCard } from './MetricCard';

function formatDay(dateStr: string): string {
  return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}`;
}

interface AppStorePanelProps {
  data: AppStoreResponse | null;
}

export function AppStorePanel({ data }: AppStorePanelProps) {
  if (!data || !data.connected || !data.app) {
    return <div className="loading">{data?.reason || 'No App Store data available.'}</div>;
  }

  const { app, reviews, downloads, activity } = data;

  return (
    <>
      <div className="metrics-row">
        <MetricCard
          label="Rating"
          value={app.rating.average != null ? `★ ${app.rating.average.toFixed(1)}` : '—'}
          subtitle={`${app.rating.count.toLocaleString()} rating${app.rating.count === 1 ? '' : 's'}`}
        />
        <MetricCard
          label="Version"
          value={app.version}
          subtitle={`released ${new Date(app.currentVersionReleaseDate).toLocaleDateString()}`}
        />
        {activity?.available ? (
          <MetricCard
            label="Daily Active Devices"
            value={activity.totals.latestActiveDevices}
            subtitle={activity.totals.latestDate
              ? `${activity.totals.latestDate} · avg ${activity.totals.avgActiveDevices}, peak ${activity.totals.peakActiveDevices}`
              : `avg ${activity.totals.avgActiveDevices}`}
          />
        ) : (
          <MetricCard label="Daily Active Devices" value="—" subtitle={activity?.reason} />
        )}
        {downloads.available ? (
          <>
            <MetricCard label="Downloads" value={downloads.totals.downloads} subtitle="in range" />
            <MetricCard label="Updates" value={downloads.totals.updates} subtitle="in range" />
          </>
        ) : (
          <MetricCard label="Downloads" value="—" subtitle={downloads.reason} />
        )}
      </div>
      {activity?.available && activity.timeseries.length > 1 && (
        <div className="chart-container">
          <h3>Daily Active Devices</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={activity.timeseries.map((d) => ({ ...d, label: formatDay(d.date) }))}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradient-active-devices" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
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
                formatter={(value, name) => [
                  Number(value).toLocaleString(),
                  name === 'activeDevices' ? 'Active Devices' : 'Sessions',
                ]}
              />
              <Area
                type="monotone"
                dataKey="activeDevices"
                stroke="#34d399"
                strokeWidth={2}
                fill="url(#gradient-active-devices)"
              />
              <Area
                type="monotone"
                dataKey="sessions"
                stroke="#f59e0b"
                strokeWidth={1.5}
                fillOpacity={0}
                fill="none"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {downloads.available && downloads.timeseries.length > 1 && (
        <div className="chart-container">
          <h3>Downloads</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={downloads.timeseries.map((d) => ({ ...d, label: formatDay(d.date) }))}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradient-downloads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
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
                formatter={(value, name) => [Number(value).toLocaleString(), name === 'downloads' ? 'Downloads' : 'Updates']}
              />
              <Area
                type="monotone"
                dataKey="downloads"
                stroke="#818cf8"
                strokeWidth={2}
                fill="url(#gradient-downloads)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {reviews.length > 0 && (
        <div className="table-section">
          <h3>Recent Reviews</h3>
          {reviews.map((r) => (
            <div key={`${r.reviewer}-${r.date}`} className="review-card">
              <div className="review-header">
                <span className="review-stars">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                <span className="review-title">{r.title}</span>
                <span className="review-meta">
                  {r.reviewer} · {r.territory} · {new Date(r.date).toLocaleDateString()}
                </span>
              </div>
              <p className="review-body">{r.body}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
