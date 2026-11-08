import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DateRange } from '../types';
import type { GameplayAudience, GameplayPlatform, GameplayReport } from '../types/gameplay';
import { MetricCard } from './MetricCard';

const LABELS: Record<GameplayAudience, string> = { all: 'All platforms', ios: 'iOS', android: 'Android', web: 'Web', other: 'Other' };
const COLORS = { ios: 'var(--accent-indigo)', android: 'var(--accent-green)', web: 'var(--accent-cyan)', other: 'var(--text-secondary)' };
const PLATFORMS: GameplayPlatform[] = ['ios', 'android', 'web', 'other'];
const displayDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function CrosswordGameplay({ range, refresh }: { range: DateRange; refresh: number }) {
  const requestKey = `${range}:${refresh}`;
  const [result, setResult] = useState<{ key: string; report?: GameplayReport; signin?: boolean; error?: boolean } | null>(null);
  const [audience, setAudience] = useState<GameplayAudience>('all');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/crossword-gameplay?range=${range}`, { signal: controller.signal }).then(async response => {
      if (controller.signal.aborted) return;
      if (response.status === 401) { setResult({ key: requestKey, signin: true }); return; }
      const report: GameplayReport = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok && report.available !== false) throw new Error('unavailable');
      setResult({ key: requestKey, report });
    }).catch(() => { if (!controller.signal.aborted) setResult({ key: requestKey, error: true }); });
    return () => controller.abort();
  }, [range, requestKey]);
  const current = result?.key === requestKey ? result : null;
  const report = current?.report;
  const intro = <div className="gameplay-heading">
    <div><p className="gameplay-eyebrow">Crossword Clash <span>Private</span></p><h1>Who’s playing</h1><p>One view of play across the apps and the website.</p></div>
    <a className="business-link" href="/?view=crossword-clash">Website &amp; installs ↗</a>
  </div>;
  if (current?.signin) return <section className="section gameplay">
    {intro}<div className="gameplay-empty"><h2>Your player activity is private</h2><p>Open Our businesses from Fable admin to sign in, then choose Crossword gameplay in this dashboard.</p><a className="business-link" href="https://fabledesigner.com/admin/business">Open Fable admin</a></div>
  </section>;
  if (!report?.available) return <section className="section gameplay">{intro}
    <p className="gameplay-empty" role="status">{!current ? 'Reading gameplay records…' : report?.available === false ? report.reason : 'Gameplay is unavailable. Use Refresh to try again.'}</p>
  </section>;
  const stats = report.segments[audience];
  const platforms = PLATFORMS.filter(key => key !== 'other' || report.segments.other.attempts > 0 || audience === 'other');
  const daily = stats.daily.map((day, i) => ({ ...day, ...Object.fromEntries(platforms.map(key => [key, report.segments[key].daily[i].attempts])) }));
  const native = report.segments.ios.attempts + report.segments.android.attempts;
  return <div className="gameplay">
    {intro}
    <div className="gameplay-period"><strong>{displayDate(report.range.from)} – {displayDate(report.range.through)}, {report.range.through.slice(0, 4)}</strong><span>Completed days · UTC</span><span>Checked {new Date(report.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></div>
    <div className="gameplay-filters" role="group" aria-label="Gameplay platform">
      {(['all', ...platforms] as GameplayAudience[]).map(key => <button key={key} type="button" aria-pressed={audience === key} onClick={() => setAudience(key)}>{LABELS[key]}</button>)}
    </div>
    <div className="metrics-row">
      <MetricCard label="Active players" value={stats.players} subtitle="Account and anonymous identities" />
      <MetricCard label="Puzzle attempts" value={stats.attempts} subtitle={`${stats.solo} solo · ${stats.multiplayer} multiplayer`} />
      <MetricCard label="Completed visits" value={stats.completions} subtitle="A completion recorded during a visit" />
      <MetricCard label="Returning players" value={stats.returning} subtitle="Also played in the preceding 90 days" />
    </div>
    <p className="gameplay-note">{stats.firstSeen} first seen in this window · {stats.signedIn} played signed in · {stats.repeatDays} played on two or more days</p>
    <p className="gameplay-caveat">Includes owner and test activity. Anonymous identities may represent the same person on different devices.</p>
    {stats.attempts === 0 ? <section className="section"><h2>No attempts recorded</h2><p>There are no recorded puzzle attempts for {audience === 'all' ? 'these dates' : `${LABELS[audience]} on these dates`}. This does not measure app launches or installs.</p></section> : <>
      <section className="section" aria-labelledby="gameplay-trend-title">
        <div className="business-heading"><h2 id="gameplay-trend-title">Daily puzzle attempts</h2><p className="gameplay-note">{audience === 'all' ? `${native} of ${stats.attempts} attempts came from the apps` : LABELS[audience]}</p></div>
        <div className="gameplay-legend">{(audience === 'all' ? platforms : [audience]).map(key => <span key={key}><i style={{ background: COLORS[key] }} />{LABELS[key]}</span>)}</div>
        <ResponsiveContainer width="100%" height={240}><BarChart data={daily} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={displayDate} stroke="var(--text-secondary)" tickLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} stroke="var(--text-secondary)" width={36} tickLine={false} />
          <Tooltip labelFormatter={value => displayDate(String(value))} contentStyle={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }} cursor={{ fill: 'var(--bg-secondary)' }} />
          {(audience === 'all' ? platforms : [audience]).map(key => <Bar key={key} dataKey={key} name={LABELS[key]} fill={COLORS[key]} stackId="attempts" maxBarSize={44} isAnimationActive={false} />)}
        </BarChart></ResponsiveContainer>
        <details className="business-definitions"><summary>Daily figures</summary><div className="business-table-scroll" tabIndex={0} role="region" aria-label="Daily gameplay figures"><table><thead><tr><th>Date (UTC)</th><th>Active players</th><th>Attempts</th><th>Completed visits</th></tr></thead><tbody>{stats.daily.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.players}</td><td>{day.attempts}</td><td>{day.completions}</td></tr>)}</tbody></table></div></details>
      </section>
      <section className="section"><h2>Across platforms</h2><p className="gameplay-note">An account can play on more than one platform. The all-platform player count is deduplicated.</p>
        <div className="business-table-scroll" tabIndex={0} role="region" aria-label="Gameplay by platform"><table><thead><tr><th scope="col">Platform</th><th scope="col">Active players</th><th scope="col">Attempts</th><th scope="col">Completed visits</th></tr></thead><tbody>{platforms.map(key => <tr key={key}><th scope="row">{LABELS[key]}</th><td>{report.segments[key].players}</td><td>{report.segments[key].attempts}</td><td>{report.segments[key].completions}</td></tr>)}</tbody></table></div>
      </section>
    </>}
    <section className="section"><h2>Registered players</h2><p className="gameplay-note">Up to 20 players, ordered by attempts. Anonymous players stay unnamed.</p>
      {!report.coverage.profilesAvailable ? <p role="status">Player names are temporarily unavailable. Gameplay totals are still available.</p> : stats.registeredPlayers.length ? <div className="business-table-scroll" tabIndex={0} role="region" aria-label="Registered player activity"><table><thead><tr><th scope="col">Username</th><th scope="col">Platform</th><th scope="col">Attempts</th><th scope="col">Completed visits</th><th scope="col">Days played</th><th scope="col">Last played (UTC)</th></tr></thead><tbody>{stats.registeredPlayers.map(player => <tr key={player.username}><th scope="row">{player.username}</th><td>{player.platforms.map(key => LABELS[key]).join(', ')}</td><td>{player.attempts}</td><td>{player.completions}</td><td>{player.days}</td><td>{displayDate(player.lastPlayed)}</td></tr>)}</tbody></table></div> : <p>No registered-player activity to show for this selection.</p>}
    </section>
    <section className="section gameplay-coverage"><h2>What this view can tell us</h2>
      <p>These are first-party gameplay records from Crossword Clash, including the iOS and Android apps. Google Analytics covers the website separately.</p>
      <p>{report.coverage.latestRecord ? `Latest recorded visit started: ${new Date(report.coverage.latestRecord).toLocaleString(undefined, { timeZone: 'UTC' })} UTC.` : 'No gameplay records were returned for the queried history.'} {report.coverage.earliestRecord ? `Earliest visit returned: ${displayDate(report.coverage.earliestRecord)}, ${report.coverage.earliestRecord.slice(0, 4)}.` : ''} Record dates do not prove continuous coverage.</p>
      <details className="business-definitions"><summary>Counting rules and limits</summary>
        <p>An attempt gains filled squares, records a wrong letter, or finishes the puzzle. Opening a puzzle alone does not count. Completed visits can include repeat solves; they are not unique puzzles.</p>
        <p>Returning players have an earlier attempt during the 90 days before this window (from {report.range.lookbackFrom}). First seen means no earlier attempt was found in that lookback, not a new install. Platform filters apply to both periods. History can be incomplete.</p>
        <p>Totals deduplicate account identities across days. Do not add daily player counts to calculate weekly players. Anonymous identities can reset or differ between devices; registered names reflect current profiles.</p>
        <p>Reporting is best effort on completion, backgrounding, and leaving a puzzle. Web analytics consent, offline use, older app builds, and failed sends can leave gaps. Owner, beta, and production activity cannot yet be separated reliably.</p>
        <p>Store downloads and installs use different reporting dates and definitions. Open Website &amp; installs for the existing acquisition reports and their coverage notices.</p>
      </details>
    </section>
  </div>;
}
