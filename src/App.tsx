import { useState } from 'react';
import { useDashboardData } from './hooks/useDashboardData';
import { MetricCard } from './components/MetricCard';
import { TrafficChart } from './components/TrafficChart';
import { TopPagesTable } from './components/TopPagesTable';
import { SourcesTable } from './components/SourcesTable';
import { ElevenLabsChart } from './components/ElevenLabsChart';
import { QuotaBar } from './components/QuotaBar';
import { ProductBreakdown } from './components/ProductBreakdown';
import { CdnChart, formatBytes } from './components/CdnChart';
import { HomeOverview } from './components/HomeOverview';
import type { DateRange } from './types';
import './App.css';

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: '1d', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const PROJECTS: { value: string; label: string; domain: string; cloudflare?: boolean; hasApiRoutes?: boolean }[] = [
  { value: 'animal-penpals', label: 'Animal Pen Pals', domain: 'animalpenpals.tech', cloudflare: true, hasApiRoutes: true },
  { value: 'space-explorer', label: 'Space Explorer', domain: 'spaceexplorer.tech', cloudflare: true },
  { value: 'periodic-table', label: 'Periodic Table', domain: 'periodictable.tech', cloudflare: true },
  { value: 'crossword-clash', label: 'Crossword Clash', domain: 'crosswordclash.com', hasApiRoutes: true },
  { value: 'ticket-for-dinner', label: 'Delivery Picker', domain: 'ticketfordinner.com', hasApiRoutes: true },
  { value: 'superbowl-squares', label: 'Superbowl Squares', domain: 'superbowl-squares.com' },
  { value: 'tabbit-rabbit', label: 'Tabbit Rabbit', domain: 'tabbitrabbit.com', hasApiRoutes: true },
  { value: 'mark-my-words', label: 'Mark My Words', domain: 'archer.biz', hasApiRoutes: true },
];

const ELEVENLABS_VIEW = '__elevenlabs__';
const PORTFOLIO_VIEW = '__portfolio__';
const HOME_VIEW = '__home__';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function App() {
  const [range, setRange] = useState<DateRange>('1d');
  const [project, setProject] = useState<string>(HOME_VIEW);
  const [trafficMetric, setTrafficMetric] = useState<'pageviews' | 'sessions' | 'users'>('pageviews');
  const currentProject = PROJECTS.find((p) => p.value === project);
  const { traffic, elevenlabs, apiUsage, cloudflare, portfolio, overview, loading, error, refetch } = useDashboardData(range, project, currentProject?.cloudflare);

  const isElevenLabsView = project === ELEVENLABS_VIEW;
  const isPortfolioView = project === PORTFOLIO_VIEW;
  const isHomeView = project === HOME_VIEW;
  const isProjectView = !isElevenLabsView && !isPortfolioView && !isHomeView;

  const projectLabels: Record<string, string> = Object.fromEntries(
    PROJECTS.map((p) => [p.value, p.label]),
  );

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <select
            className="project-select"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <optgroup label="Overview">
              <option value={HOME_VIEW}>Home</option>
            </optgroup>
            <optgroup label="Projects">
              {PROJECTS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </optgroup>
            <optgroup label="Account">
              <option value={PORTFOLIO_VIEW}>Portfolio</option>
              <option value={ELEVENLABS_VIEW}>ElevenLabs</option>
            </optgroup>
          </select>
        </div>
        <div className="header-controls">
          <div className="range-selector">
            {DATE_RANGES.map((r) => (
              <button
                key={r.value}
                className={`range-btn ${range === r.value ? 'active' : ''}`}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button className="refresh-btn" onClick={refetch} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && (isProjectView || isHomeView) && <div className="error-banner">{error}</div>}

      {isHomeView ? (
        overview ? (
          <HomeOverview
            data={overview}
            projectLabels={projectLabels}
            onSelectProject={setProject}
          />
        ) : (
          <section className="section">
            <div className="loading">{loading ? 'Loading overview...' : 'No data.'}</div>
          </section>
        )
      ) : isPortfolioView ? (
        <section className="section">
          <h2>Portfolio Summary</h2>
          {portfolio && portfolio.projects.length > 0 ? (
            <>
              <div className="metrics-row">
                <MetricCard
                  label="Total API Requests"
                  value={portfolio.projects.reduce((s, p) => s + p.requests, 0)}
                />
                <MetricCard
                  label="Estimated Cost"
                  value={formatCost(portfolio.projects.reduce((s, p) => s + p.estimatedCost, 0))}
                />
                <MetricCard
                  label="Projects with Usage"
                  value={portfolio.projects.length}
                  subtitle={`of ${PROJECTS.length} total`}
                />
              </div>
              <div className="table-section">
                <h3>Cost by Project</h3>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Requests</th>
                        <th>Tokens</th>
                        <th>Characters</th>
                        <th>Est. Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio.projects.map((p) => (
                        <tr key={p.project}>
                          <td>{PROJECTS.find((pr) => pr.value === p.project)?.label ?? p.project}</td>
                          <td>{p.requests.toLocaleString()}</td>
                          <td>{(p.tokensIn + p.tokensOut).toLocaleString()}</td>
                          <td>{p.characters > 0 ? p.characters.toLocaleString() : '—'}</td>
                          <td className="page-path">{formatCost(p.estimatedCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="loading">
              {loading ? 'Loading...' : 'No API usage data yet across projects.'}
            </div>
          )}
        </section>
      ) : isElevenLabsView ? (
        <section className="section">
          <h2>ElevenLabs Account Usage</h2>
          {elevenlabs && (
            <>
              <div className="metrics-row">
                <MetricCard
                  label="Characters Used"
                  value={elevenlabs.subscription.characterCount}
                  subtitle={`of ${elevenlabs.subscription.characterLimit.toLocaleString()} limit`}
                />
                <MetricCard
                  label="Plan"
                  value={elevenlabs.subscription.tier.charAt(0).toUpperCase() + elevenlabs.subscription.tier.slice(1)}
                />
                <MetricCard
                  label="Resets"
                  value={new Date(elevenlabs.subscription.nextResetUnix * 1000).toLocaleDateString()}
                />
                <MetricCard
                  label="Daily Average"
                  value={elevenlabs.timeseries.length > 0
                    ? Math.round(elevenlabs.timeseries.reduce((sum, d) => sum + d.characters, 0) / elevenlabs.timeseries.length)
                    : 0}
                  subtitle="characters/day"
                />
              </div>
              <QuotaBar
                used={elevenlabs.subscription.characterCount}
                limit={elevenlabs.subscription.characterLimit}
                label="Character Quota"
              />
              <div className="tables-row">
                <div className="table-section">
                  <h3>Usage by Product</h3>
                  <ProductBreakdown data={elevenlabs.productBreakdown} />
                </div>
                <div className="table-section">
                  <h3>Daily Usage</h3>
                  <ElevenLabsChart data={elevenlabs.timeseries} />
                </div>
              </div>
            </>
          )}
          {loading && !elevenlabs && <div className="loading">Loading ElevenLabs data...</div>}
        </section>
      ) : (
        <>
          <section className="section">
            <h2>Traffic</h2>
            {traffic && (
              <>
                <div className="metrics-row">
                  <MetricCard label="Pageviews" value={traffic.totals.pageviews} />
                  <MetricCard label="Sessions" value={traffic.totals.sessions} />
                  <MetricCard label="Users" value={traffic.totals.users}
                    subtitle={`${traffic.totals.newUsers} new`} />
                  <MetricCard label="Engagement" value={`${(traffic.totals.engagementRate * 100).toFixed(0)}%`}
                    subtitle={formatDuration(traffic.totals.avgSessionDuration)} />
                  <MetricCard label="Bounce Rate" value={`${(traffic.totals.bounceRate * 100).toFixed(0)}%`} />
                </div>
                <div className="chart-header">
                  <div className="metric-toggle">
                    {(['pageviews', 'sessions', 'users'] as const).map((m) => (
                      <button
                        key={m}
                        className={`toggle-btn ${trafficMetric === m ? 'active' : ''}`}
                        onClick={() => setTrafficMetric(m)}
                      >
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <TrafficChart data={traffic.timeseries} metric={trafficMetric} />
                <div className="tables-row">
                  <div className="table-section">
                    <h3>Top Pages</h3>
                    <TopPagesTable data={traffic.topPages} />
                  </div>
                  <div className="table-section">
                    <h3>Traffic Sources (by quality)</h3>
                    <SourcesTable data={traffic.sources} />
                  </div>
                </div>
              </>
            )}
            {loading && !traffic && <div className="loading">Loading traffic data...</div>}
          </section>

          <section className="section">
            <h2>API Usage</h2>
            {apiUsage && apiUsage.totals.length > 0 ? (
              <>
                <div className="metrics-row">
                  {apiUsage.totals.map((t) => (
                    <MetricCard
                      key={t.service}
                      label={t.service.charAt(0).toUpperCase() + t.service.slice(1)}
                      value={t.requests}
                      subtitle={t.service === 'anthropic'
                        ? `${Number(t.tokens_in).toLocaleString()} in / ${Number(t.tokens_out).toLocaleString()} out`
                        : `${Number(t.characters).toLocaleString()} chars`}
                    />
                  ))}
                  <MetricCard
                    label="Est. Cost"
                    value={formatCost(apiUsage.totalCost)}
                    subtitle={apiUsage.totals.reduce((s, t) => s + t.requests, 0) > 0
                      ? `${formatCost(apiUsage.totalCost / apiUsage.totals.reduce((s, t) => s + t.requests, 0))}/req`
                      : ''}
                  />
                </div>
                {apiUsage.recentCalls.length > 0 && (
                  <div className="table-section">
                    <h3>Recent API Calls</h3>
                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Service</th>
                            <th>Endpoint</th>
                            <th>Usage</th>
                          </tr>
                        </thead>
                        <tbody>
                          {apiUsage.recentCalls.map((call, i) => (
                            <tr key={i}>
                              <td className="source-medium">{new Date(call.timestamp).toLocaleString()}</td>
                              <td>{call.service}</td>
                              <td className="page-path">{call.endpoint}</td>
                              <td>
                                {call.service === 'anthropic'
                                  ? `${call.tokens_in + call.tokens_out} tokens`
                                  : `${call.characters} chars`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="loading">
                {loading ? 'Loading...' : currentProject?.hasApiRoutes
                  ? `No API usage data yet for ${currentProject.label}.`
                  : `${currentProject?.label ?? 'This project'} uses client-side APIs only — no server-side usage to track.`}
              </div>
            )}
          </section>

          {currentProject?.cloudflare && cloudflare && (
            <section className="section">
              <h2>CDN (Cloudflare)</h2>
              <div className="metrics-row">
                <MetricCard label="Bandwidth" value={formatBytes(cloudflare.totals.bandwidth)} />
                <MetricCard
                  label="Cache Hit Ratio"
                  value={`${cloudflare.totals.cacheHitRatio.toFixed(1)}%`}
                  subtitle={`${formatBytes(cloudflare.totals.cachedBandwidth)} cached`}
                />
                <MetricCard
                  label="Requests"
                  value={cloudflare.totals.requests}
                  subtitle={`${cloudflare.totals.cachedRequests.toLocaleString()} cached`}
                />
                {cloudflare.r2 && (
                  <MetricCard
                    label="R2 Storage"
                    value={formatBytes(cloudflare.r2.storageSizeBytes)}
                    subtitle={`${cloudflare.r2.objectCount.toLocaleString()} objects`}
                  />
                )}
              </div>
              <CdnChart data={cloudflare.timeseries} />
            </section>
          )}
        </>
      )}

      <footer className="dashboard-footer">
        <span>{isHomeView ? 'All Projects' : isPortfolioView ? 'All Projects' : isElevenLabsView ? 'ElevenLabs Account' : currentProject?.domain}</span>
      </footer>
    </div>
  );
}

export default App;
