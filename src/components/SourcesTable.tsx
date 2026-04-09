import type { TrafficSource } from '../types';

interface SourcesTableProps {
  data: TrafficSource[];
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export function SourcesTable({ data }: SourcesTableProps) {
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Medium</th>
            <th>Sessions</th>
            <th>Avg Duration</th>
          </tr>
        </thead>
        <tbody>
          {data.map((s, i) => (
            <tr key={i}>
              <td>{s.source}</td>
              <td className="source-medium">{s.medium}</td>
              <td>{s.sessions.toLocaleString()}</td>
              <td className="source-medium">{formatDuration(s.avgSessionDuration)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
