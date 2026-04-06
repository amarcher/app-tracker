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
import type { DateRange } from './types';
import './App.css';

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const PROJECTS: { value: string; label: string; domain: string; cloudflare?: boolean }[] = [
  { value: 'animal-penpals', label: 'Animal Pen Pals', domain: 'animalpenpals.tech', cloudflare: true },
  { value: 'space-explorer', label: 'Space Explorer', domain: 'spaceexplorer.tech' },
  { value: 'periodic-table', label: 'Periodic Table', domain: 'periodictable.tech', cloudflare: true },
  { value: 'crossword-clash', label: 'Crossword Clash', domain: 'crosswordclash.com' },
  { value: 'ticket-for-dinner', label: 'Delivery Picker', domain: 'ticketfordinner.com' },
  { value: 'superbowl-squares', label: 'Superbowl Squares', domain: 'superbowl-squares.com' },
  { value: 'tabbit-rabbit', label: 'Tabbit Rabbit', domain: 'tabbitrabbit.com' },
  { value: 'mark-my-words', label: 'Mark My Words', domain: 'archer.biz' },
];

const ELEVENLABS_VIEW = '__elevenlabs__';

function App() {
  const [range, setRange] = useState<DateRange>('30d');
  const [project, setProject] = useState(PROJECTS[0].value);
  const [trafficMetric, setTrafficMetric] = useState<'pageviews' | 'sessions' | 'users'>('pageviews');
  const currentProject = PROJECTS.find((p) => p.value === project);
  const { traffic, elevenlabs, apiUsage, cloudflare, loading, error, refetch } = useDashboardData(range, project, currentProject?.cloudflare);

  const isElevenLabsView = project === ELEVENLABS_VIEW;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <div className="project-selector">
            {PROJECTS.map((p) => (
              <button
                key={p.value}
                className={`project-btn ${project === p.value ? 'active' : ''}`}
                onClick={() => setProject(p.value)}
              >
                {p.label}
              </button>
            ))}
            <button
              className={`project-btn project-btn--account ${isElevenLabsView ? 'active' : ''}`}
              onClick={() => setProject(ELEVENLABS_VIEW)}
            >
              ElevenLabs
            </button>
          </div>
          <span className="header-subtitle">App Dashboard</span>
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

      {error && !isElevenLabsView && <div className="error-banner">{error}</div>}

      {isElevenLabsView ? (
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
                  <MetricCard label="Users" value={traffic.totals.users} />
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
                    <h3>Traffic Sources</h3>
                    <SourcesTable data={traffic.sources} />
                  </div>
                </div>
              </>
            )}
            {loading && !traffic && <div className="loading">Loading traffic data...</div>}
          </section>

          <section className="section">
            <h2>API Usage (per-project)</h2>
            {apiUsage && apiUsage.totals.length > 0 ? (
              <>
                <div className="metrics-row">
                  {apiUsage.totals.map((t) => (
                    <MetricCard
                      key={t.service}
                      label={t.service.charAt(0).toUpperCase() + t.service.slice(1)}
                      value={t.requests}
                      subtitle={t.service === 'anthropic'
                        ? `${Number(t.tokens_in).toLocaleString()} in / ${Number(t.tokens_out).toLocaleString()} out tokens`
                        : `${Number(t.characters).toLocaleString()} characters`}
                    />
                  ))}
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
                {loading ? 'Loading...' : `No API usage data yet for ${currentProject?.label ?? 'this project'}.`}
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
        <span>{isElevenLabsView ? 'ElevenLabs Account' : currentProject?.domain}</span>
      </footer>
    </div>
  );
}

export default App;
