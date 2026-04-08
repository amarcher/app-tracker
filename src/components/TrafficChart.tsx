import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { TrafficDataPoint } from '../types';

function formatDate(dateStr: string): string {
  // Daily: "YYYYMMDD" → "MM/DD"
  // Hourly: "YYYYMMDDHH" → "HH:00"
  if (dateStr.length === 10) {
    return `${dateStr.slice(8, 10)}:00`;
  }
  const m = dateStr.slice(4, 6);
  const d = dateStr.slice(6, 8);
  return `${m}/${d}`;
}

interface TrafficChartProps {
  data: TrafficDataPoint[];
  metric: 'pageviews' | 'sessions' | 'users';
}

const COLORS = {
  pageviews: '#6366f1',
  sessions: '#06b6d4',
  users: '#10b981',
};

export function TrafficChart({ data, metric }: TrafficChartProps) {
  const formatted = data.map((d) => ({ ...d, label: formatDate(d.date) }));
  const color = COLORS[metric];

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={formatted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`gradient-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
          <XAxis dataKey="label" stroke="#6b7280" fontSize={12} />
          <YAxis stroke="#6b7280" fontSize={12} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e1e2e',
              border: '1px solid #3a3a5e',
              borderRadius: '8px',
              color: '#e2e8f0',
            }}
          />
          <Area
            type="monotone"
            dataKey={metric}
            stroke={color}
            strokeWidth={2}
            fill={`url(#gradient-${metric})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
