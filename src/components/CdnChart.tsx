import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { CdnDataPoint } from '../types';

function formatDate(dateStr: string): string {
  const m = dateStr.slice(4, 6);
  const d = dateStr.slice(6, 8);
  return `${m}/${d}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

interface CdnChartProps {
  data: CdnDataPoint[];
}

type CdnMetric = 'bandwidth' | 'requests';

export function CdnChart({ data }: CdnChartProps) {
  const [metric, setMetric] = useState<CdnMetric>('bandwidth');

  const formatted = data.map((d) => ({
    label: formatDate(d.date),
    cached: metric === 'bandwidth' ? d.cachedBytes : d.cachedRequests,
    uncached: metric === 'bandwidth' ? d.bytes - d.cachedBytes : d.requests - d.cachedRequests,
  }));

  return (
    <div>
      <div className="chart-header">
        <div className="metric-toggle">
          {(['bandwidth', 'requests'] as const).map((m) => (
            <button
              key={m}
              className={`toggle-btn ${metric === m ? 'active' : ''}`}
              onClick={() => setMetric(m)}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={formatted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradient-cached" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradient-uncached" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
            <XAxis dataKey="label" stroke="#6b7280" fontSize={12} />
            <YAxis
              stroke="#6b7280"
              fontSize={12}
              tickFormatter={metric === 'bandwidth' ? formatBytes : undefined}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e1e2e',
                border: '1px solid #3a3a5e',
                borderRadius: '8px',
                color: '#e2e8f0',
              }}
              formatter={(value, name) => [
                metric === 'bandwidth' ? formatBytes(Number(value)) : Number(value).toLocaleString(),
                name === 'cached' ? 'Cached' : 'Uncached',
              ]}
            />
            <Area
              type="monotone"
              dataKey="cached"
              stackId="1"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#gradient-cached)"
            />
            <Area
              type="monotone"
              dataKey="uncached"
              stackId="1"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#gradient-uncached)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export { formatBytes };
