import type { SearchConsoleSitesResponse } from '../types';

interface SearchConsoleSurveyProps {
  data: SearchConsoleSitesResponse | null;
  projectLabels: Record<string, string>;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Active';
    case 'connected-no-data': return 'No data';
    case 'missing-property': return 'Missing';
    case 'query-error': return 'Error';
    default: return status;
  }
}

function statusClass(status: string): string {
  if (status === 'active') return 'status-pill status-active';
  if (status === 'connected-no-data') return 'status-pill status-warn';
  return 'status-pill status-missing';
}

export function SearchConsoleSurvey({ data, projectLabels }: SearchConsoleSurveyProps) {
  if (!data) {
    return <div className="loading">Search Console survey unavailable.</div>;
  }

  return (
    <section className="section">
      <h2>Search Console Coverage</h2>
      <div className="section-note">
        Surveying tracked project domains against accessible Search Console properties for {data.dateRange.startDate} to {data.dateRange.endDate}.
      </div>
      {data.setupError && (
        <div className="empty-panel search-setup-panel">
          Search Console API setup is incomplete. Enable the API for the Google project used by the GA4 service account, then rerun this survey.
        </div>
      )}
      <div className="table-section">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Domain</th>
                <th>Status</th>
                <th>Property</th>
                <th>Clicks</th>
                <th>Impr.</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((project) => (
                <tr key={project.project}>
                  <td>{projectLabels[project.project] ?? project.project}</td>
                  <td className="page-path">{project.domain}</td>
                  <td><span className={statusClass(project.status)}>{statusLabel(project.status)}</span></td>
                  <td className="page-path">{project.siteUrl ?? '—'}</td>
                  <td>{project.clicks.toLocaleString()}</td>
                  <td>{project.impressions.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
