import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { AmazonAppstoreResponse } from '../types';
import { MetricCard } from './MetricCard';

function formatDay(dateStr: string): string {
  return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}`;
}

interface AmazonAppstorePanelProps {
  data: AmazonAppstoreResponse | null;
}

export function AmazonAppstorePanel({ data }: AmazonAppstorePanelProps) {
  if (!data || !data.connected || !data.app) {
    return <div className="loading">{data?.reason || 'No Amazon Appstore data available.'}</div>;
  }

  const { downloads, stats } = data;

  return (
    <>
      <div className="metrics-row">
        {downloads.available ? (
          <MetricCard label="Downloads" value={downloads.totals.downloads} subtitle="in range · sales units" />
        ) : (
          <MetricCard label="Downloads" value="—" subtitle={downloads.reason} />
        )}
        {stats.available ? (
          <>
            <MetricCard
              label="Daily Active Users"
              value={stats.totals.latestDau}
              subtitle={`${stats.totals.latestDate} · avg ${stats.totals.avgDau}, peak ${stats.totals.peakDau}`}
            />
            <MetricCard label="MAU" value={stats.totals.latestMau} subtitle={`WAU ${stats.totals.latestWau}`} />
            <MetricCard label="Installs" value={stats.totals.installs} subtitle="unique, in range" />
            <MetricCard
              label="Current Installs"
              value={stats.totals.currentInstalls}
              subtitle="devices with the app installed"
            />
          </>
        ) : (
          <MetricCard label="Daily Active Users" value="—" subtitle={stats.reason} />
        )}
      </div>

      {downloads.available && downloads.timeseries.length > 1 && (
        <div className="chart-container">
          <h3>Downloads</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={downloads.timeseries.map((d) => ({ ...d, label: formatDay(d.date) }))}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradient-amazon-downloads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ff9900" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ff9900" stopOpacity={0} />
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
                formatter={(value) => [Number(value).toLocaleString(), 'Downloads']}
              />
              <Area
                type="monotone"
                dataKey="downloads"
                stroke="#ff9900"
                strokeWidth={2}
                fill="url(#gradient-amazon-downloads)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {stats.available && stats.timeseries.length > 1 && (
        <div className="chart-container">
          <h3>Active Users</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={stats.timeseries.map((d) => ({ ...d, label: formatDay(d.date) }))}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradient-amazon-dau" x1="0" y1="0" x2="0" y2="1">
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
                  name === 'dau' ? 'DAU' : name === 'mau' ? 'MAU' : 'Installs',
                ]}
              />
              <Area
                type="monotone"
                dataKey="dau"
                stroke="#34d399"
                strokeWidth={2}
                fill="url(#gradient-amazon-dau)"
              />
              <Area type="monotone" dataKey="mau" stroke="#818cf8" strokeWidth={1.5} fillOpacity={0} fill="none" />
              <Area type="monotone" dataKey="installs" stroke="#f59e0b" strokeWidth={1.5} fillOpacity={0} fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="panel-note">
        Downloads come from the Appstore Reporting API (sales units, near real time). Installs and active
        users come from the Download Center CSVs, which Amazon publishes with a 72h (acquisition) and 96h
        (engagement) lag and exposes through no API — refresh them with{' '}
        <code>scripts/ingest-amazon-reports.mjs</code>.
      </p>
    </>
  );
}
