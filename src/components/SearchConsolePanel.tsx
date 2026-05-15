import type { SearchConsoleResponse } from '../types';
import { MetricCard } from './MetricCard';

interface SearchConsolePanelProps {
  data: SearchConsoleResponse | null;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPosition(value: number): string {
  return value > 0 ? value.toFixed(1) : '—';
}

export function SearchConsolePanel({ data }: SearchConsolePanelProps) {
  if (!data) {
    return <div className="loading">Search Console data unavailable.</div>;
  }

  if (!data.connected) {
    return (
      <div className="empty-panel">
        {data.setupError
          ? 'Search Console needs setup before data can load. Enable the Search Console API for the Google project used by the service account, then add the service account to each Search Console property.'
          : 'No accessible Search Console property was found for this project. Add the shared Google service account to the domain property, or set a matching GSC_SITE_URL_* env var.'}
      </div>
    );
  }

  return (
    <>
      <div className="section-note">
        {data.siteUrl} · final Search Console data from {data.dateRange.startDate} to {data.dateRange.endDate}
      </div>
      <div className="metrics-row">
        <MetricCard label="Search Clicks" value={data.totals.clicks} />
        <MetricCard label="Impressions" value={data.totals.impressions} />
        <MetricCard label="CTR" value={formatPct(data.totals.ctr)} />
        <MetricCard label="Avg Position" value={formatPosition(data.totals.position)} />
      </div>

      {data.opportunities.length > 0 && (
        <div className="table-section search-opportunities">
          <h3>Opportunities</h3>
          <div className="opportunity-list">
            {data.opportunities.map((item, index) => (
              <div className="opportunity-card" key={`${item.type}-${item.label}-${index}`}>
                <div>
                  <div className="opportunity-label">{item.label}</div>
                  <div className="opportunity-detail">{item.detail}</div>
                </div>
                <div className="opportunity-type">
                  {item.type === 'low-ctr' ? 'Low CTR' : 'Position 8-20'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tables-row">
        <div className="table-section">
          <h3>Queries</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Query</th>
                  <th>Clicks</th>
                  <th>Impr.</th>
                  <th>CTR</th>
                  <th>Pos.</th>
                </tr>
              </thead>
              <tbody>
                {data.queries.map((q) => (
                  <tr key={q.query}>
                    <td className="page-path">{q.query}</td>
                    <td>{q.clicks.toLocaleString()}</td>
                    <td>{q.impressions.toLocaleString()}</td>
                    <td>{formatPct(q.ctr)}</td>
                    <td>{formatPosition(q.position)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="table-section">
          <h3>Pages</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Clicks</th>
                  <th>Impr.</th>
                  <th>CTR</th>
                  <th>Pos.</th>
                </tr>
              </thead>
              <tbody>
                {data.pages.map((p) => (
                  <tr key={p.page}>
                    <td className="page-path">{p.page.replace(/^https?:\/\//, '')}</td>
                    <td>{p.clicks.toLocaleString()}</td>
                    <td>{p.impressions.toLocaleString()}</td>
                    <td>{formatPct(p.ctr)}</td>
                    <td>{formatPosition(p.position)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
