import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { PosthogTimeseriesPoint } from '../types';

function formatDate(dateStr: string): string {
  if (dateStr.length === 10) {
    return `${dateStr.slice(8, 10)}:00`;
  }
  const m = dateStr.slice(4, 6);
  const d = dateStr.slice(6, 8);
  return `${m}/${d}`;
}

const SERIES = [
  { key: 'planet_viewed', label: 'Planets', color: '#6366f1' },
  { key: 'moon_viewed', label: 'Moons', color: '#8b5cf6' },
  { key: 'sun_viewed', label: 'Sun', color: '#f59e0b' },
  { key: 'voice_agent_activated', label: 'Voice Agent', color: '#10b981' },
  { key: 'exploration_milestone', label: 'Milestones', color: '#06b6d4' },
] as const;

interface PosthogChartProps {
  data: PosthogTimeseriesPoint[];
}

export function PosthogChart({ data }: PosthogChartProps) {
  const formatted = data.map((d) => ({ ...d, label: formatDate(d.date) }));

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={formatted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`gradient-ph-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
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
          <Legend />
          {SERIES.map((s) => (
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
      </ResponsiveContainer>
    </div>
  );
}
