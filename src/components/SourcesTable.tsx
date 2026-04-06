import type { TrafficSource } from '../types';

interface SourcesTableProps {
  data: TrafficSource[];
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
            <th>Users</th>
          </tr>
        </thead>
        <tbody>
          {data.map((s, i) => (
            <tr key={i}>
              <td>{s.source}</td>
              <td className="source-medium">{s.medium}</td>
              <td>{s.sessions.toLocaleString()}</td>
              <td>{s.users.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
