import type { TopPage } from '../types';

interface TopPagesTableProps {
  data: TopPage[];
}

export function TopPagesTable({ data }: TopPagesTableProps) {
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Page</th>
            <th>Views</th>
            <th>Sessions</th>
          </tr>
        </thead>
        <tbody>
          {data.map((page) => (
            <tr key={page.path}>
              <td className="page-path">{page.path}</td>
              <td>{page.pageviews.toLocaleString()}</td>
              <td>{page.sessions.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
