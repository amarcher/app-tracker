import type { TrafficOverviewResponse, TrafficOverviewProject } from '../types';
import { MetricCard } from './MetricCard';

interface HomeOverviewProps {
  data: TrafficOverviewResponse;
  projectLabels: Record<string, string>;
  onSelectProject: (project: string) => void;
}

function priorLabel(range: string): string {
  switch (range) {
    case '1d': return 'vs prior 24h';
    case '7d': return 'vs prior 7 days';
    case '30d': return 'vs prior 30 days';
    case '90d': return 'vs prior 90 days';
    default: return 'vs prev period';
  }
}

function formatChange(pct: number): { text: string; className: string } {
  if (!isFinite(pct) || isNaN(pct)) return { text: '—', className: 'change-neutral' };
  const rounded = Math.round(pct);
  if (rounded === 0) return { text: '0%', className: 'change-neutral' };
  if (rounded > 0) return { text: `▲ ${rounded}%`, className: 'change-up' };
  return { text: `▼ ${Math.abs(rounded)}%`, className: 'change-down' };
}

// Require meaningful baseline volume before treating a % change as a "trend"
const MIN_BASELINE_USERS = 20;

export function HomeOverview({ data, projectLabels, onSelectProject }: HomeOverviewProps) {
  const label = (p: string) => projectLabels[p] ?? p;

  const totalUsers = data.projects.reduce((s, p) => s + p.current.users, 0);
  const totalSessions = data.projects.reduce((s, p) => s + p.current.sessions, 0);
  const totalPageviews = data.projects.reduce((s, p) => s + p.current.pageviews, 0);
  const totalNewUsers = data.projects.reduce((s, p) => s + p.current.newUsers, 0);

  const prevTotalUsers = data.projects.reduce(
    (s, p) => s + (p.previous?.users ?? 0),
    0,
  );
  const aggregateChange = prevTotalUsers > 0
    ? ((totalUsers - prevTotalUsers) / prevTotalUsers) * 100
    : 0;
  const aggregateChangeFmt = formatChange(aggregateChange);

  // Trends: only include projects with enough prior volume to avoid noise
  const trendCandidates = data.projects.filter(
    (p) => p.previous && p.previous.users >= MIN_BASELINE_USERS,
  );
  const sortedByChange = [...trendCandidates].sort(
    (a, b) => b.usersChangePct - a.usersChangePct,
  );
  const topGainers = sortedByChange.filter((p) => p.usersChangePct > 0).slice(0, 3);
  const topDecliners = sortedByChange
    .filter((p) => p.usersChangePct < 0)
    .slice(-3)
    .reverse();

  const leaderboard = [...data.projects].sort((a, b) => b.current.users - a.current.users);

  const renderMoverCard = (p: TrafficOverviewProject) => {
    const change = formatChange(p.usersChangePct);
    return (
      <button
        key={p.project}
        className="mover-card"
        onClick={() => onSelectProject(p.project)}
      >
        <div className="mover-project">{label(p.project)}</div>
        <div className={`mover-change ${change.className}`}>{change.text}</div>
        <div className="mover-detail">
          {p.current.users.toLocaleString()} users
          {p.previous ? ` (was ${p.previous.users.toLocaleString()})` : ''}
        </div>
      </button>
    );
  };

  return (
    <>
      <section className="section">
        <h2>Overview</h2>
        <div className="metrics-row">
          <MetricCard
            label="Total Users"
            value={totalUsers}
            subtitle={`${aggregateChangeFmt.text} ${priorLabel(data.range)}`}
          />
          <MetricCard label="Sessions" value={totalSessions} />
          <MetricCard label="Pageviews" value={totalPageviews} />
          <MetricCard label="New Users" value={totalNewUsers} />
          <MetricCard
            label="Active Projects"
            value={data.projects.filter((p) => p.current.users > 0).length}
            subtitle={`of ${data.projects.length} tracked`}
          />
        </div>
      </section>

      {(topGainers.length > 0 || topDecliners.length > 0) && (
        <section className="section">
          <h2>Biggest Movers</h2>
          <div className="movers-grid">
            <div className="movers-column">
              <h3 className="movers-heading change-up">Trending Up</h3>
              {topGainers.length > 0 ? (
                topGainers.map(renderMoverCard)
              ) : (
                <div className="loading">No upward trends.</div>
              )}
            </div>
            <div className="movers-column">
              <h3 className="movers-heading change-down">Trending Down</h3>
              {topDecliners.length > 0 ? (
                topDecliners.map(renderMoverCard)
              ) : (
                <div className="loading">No downward trends.</div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Leaderboard</h2>
        <div className="table-section">
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Project</th>
                  <th>Users</th>
                  <th>Sessions</th>
                  <th>Pageviews</th>
                  <th>Change (users)</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((p, i) => {
                  const change = formatChange(p.usersChangePct);
                  return (
                    <tr
                      key={p.project}
                      className="leaderboard-row"
                      onClick={() => onSelectProject(p.project)}
                    >
                      <td>{i + 1}</td>
                      <td>{label(p.project)}</td>
                      <td>{p.current.users.toLocaleString()}</td>
                      <td>{p.current.sessions.toLocaleString()}</td>
                      <td>{p.current.pageviews.toLocaleString()}</td>
                      <td className={change.className}>{change.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
