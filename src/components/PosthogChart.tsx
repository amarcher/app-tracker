import { useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from 'recharts';
import type { PosthogTimeseriesPoint, PosthogEventTotal } from '../types';

function formatDate(dateStr: string): string {
  if (dateStr.length === 10) {
    return `${dateStr.slice(8, 10)}:00`;
  }
  const m = dateStr.slice(4, 6);
  const d = dateStr.slice(6, 8);
  return `${m}/${d}`;
}

const PALETTE = [
  '#6366f1', '#8b5cf6', '#f59e0b', '#10b981', '#06b6d4',
  '#ec4899', '#f97316', '#14b8a6',
];

interface PosthogChartProps {
  data: PosthogTimeseriesPoint[];
  totals: PosthogEventTotal[];
}

type ChartView = 'totals' | 'timeseries';

export function PosthogChart({ data, totals }: PosthogChartProps) {
  const [view, setView] = useState<ChartView>('totals');
  const formatted = data.map((d) => ({ ...d, label: formatDate(d.date) }));
  const series = totals.map((t, i) => ({
    key: t.event,
    label: t.label,
    color: PALETTE[i % PALETTE.length],
  }));
  const barData = totals.map((t, i) => ({
    label: t.label,
    count: t.count,
    color: PALETTE[i % PALETTE.length],
  }));

  const tooltipStyle = {
    backgroundColor: '#1e1e2e',
    border: '1px solid #3a3a5e',
    borderRadius: '8px',
    color: '#e2e8f0',
  };

  return (
    <>
      <div className="chart-header">
        <div className="metric-toggle">
          {(['totals', 'timeseries'] as const).map((v) => (
            <button
              key={v}
              className={`toggle-btn ${view === v ? 'active' : ''}`}
              onClick={() => setView(v)}
            >
              {v === 'totals' ? 'Totals' : 'Over Time'}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={280}>
          {view === 'totals' ? (
            <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
              <XAxis dataKey="label" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} />
              <Tooltip cursor={{ fill: '#2a2a3e33' }} contentStyle={tooltipStyle} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {barData.map((d) => (
                  <Cell key={d.label} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <AreaChart data={formatted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {series.map((s) => (
                  <linearGradient key={s.key} id={`gradient-ph-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
              <XAxis dataKey="label" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#gradient-ph-${s.key})`}
                  stackId="1"
                />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </>
  );
}
