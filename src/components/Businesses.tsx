import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BusinessSummary, BusinessTotals } from '../types/business';
import type { DateRange } from '../types';
import { MetricCard } from './MetricCard';

const STORE_LABELS = { apple: 'Apple App Store', amazon: 'Amazon Appstore', google: 'Google Play' } as const;
const STORE_ORDER = ['apple', 'amazon', 'google'] as const;

/** Range-independent: sums every archived report day, so it only reads "all time" once history reaches the first release. */
function AllTimeInstalls({ apps }: { apps: BusinessSummary['apps'] }) {
  const partial = apps.some(app => app.stores.some(store => !store.recordedFromStart));
  return <section className="section">
    <h2>All-time new installs</h2>
    <p className="business-freshness">First-time installs on each store since release. Redownloads and updates are not counted.</p>
    <div className="business-table-scroll"><table className="business-alltime">
      <thead><tr><th scope="col">App</th>{STORE_ORDER.map(store => <th scope="col" key={store}>{STORE_LABELS[store]}</th>)}<th scope="col">All stores</th></tr></thead>
      <tbody>{apps.map(app => {
        const cells = STORE_ORDER.map(name => app.stores.find(store => store.store === name));
        const total = cells.every(store => store?.recordedDownloads != null && store.recordedFromStart)
          ? cells.reduce((sum, store) => sum + store!.recordedDownloads!, 0) : null;
        return <tr key={app.project}><th scope="row">{app.name}</th>
          {cells.map((store, index) => <td key={STORE_ORDER[index]}>{store?.recordedDownloads == null ? '—'
            : <>{store.recordedDownloads.toLocaleString()}{store.recordedFromStart ? null : <span title={`Recorded since ${store.recordedSince}`}>*</span>}</>}</td>)}
          <td>{total === null ? '—' : total.toLocaleString()}</td></tr>;
      })}</tbody>
    </table></div>
    {partial ? <p className="business-freshness">* Recorded since the date shown on hover. The history does not reach the app’s release yet. — means the store has not provided a report.</p> : null}
  </section>;
}

const cash = (value: number | null) => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
export function Businesses({ range, refresh }: { range: DateRange; refresh: number }) {
  const [data, setData] = useState<BusinessSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signin' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setData(null);
    fetch(`/api/business?range=${range}`, { signal: controller.signal }).then(async response => {
      if (response.status === 401) { setState('signin'); return; }
      if (!response.ok) throw new Error('unavailable');
      setData(await response.json()); setState('ready');
    }).catch(() => { if (!controller.signal.aborted) setState('error'); });
    return () => controller.abort();
  }, [range, refresh]);

  if (state === 'signin') return <section className="section business-intro"><h1>Our businesses</h1><p>Books made, customers reached, and sales collected.</p><p>Open this private view from Fable Designer’s admin page.</p><a className="business-link" href="https://fabledesigner.com/admin/business">Open Fable admin</a></section>;
  if (!data) return <section className="section"><h1>Our businesses</h1><p role="status">{state === 'loading' ? 'Gathering the latest reports…' : 'The figures are unavailable. Try refreshing.'}</p></section>;
  const fable = data.fable;
  const change = (key: keyof BusinessTotals) => {
    if (!fable || fable.totals[key] === null || fable.previous[key] === null) return 'Previous period unavailable';
    const delta = fable.totals[key]! - fable.previous[key]!;
    const value = key.endsWith('Cents') ? cash(Math.abs(delta)) : Math.abs(delta).toLocaleString();
    return delta === 0 ? 'Same as the previous period' : `${delta > 0 ? '+' : '−'}${value} vs the previous period`;
  };
  return <div className="businesses">
    <div className="business-intro"><h1>Our businesses</h1><p>{data.range.from} through {data.range.through} (UTC)</p><p className="business-freshness">{data.stale ? 'Showing the last saved report' : 'Updated'} {new Date(data.generatedAt).toLocaleString()}</p></div>
    <AllTimeInstalls apps={data.apps} />
    <section className="section">
      <div className="business-heading"><h2>Fable Designer</h2><a href="https://fabledesigner.com/admin/business">Open admin</a></div>
      {fable ? <>
        <div className="metrics-row">
          <MetricCard label="Books created" value={fable.totals.booksCreated} subtitle={change('booksCreated')} />
          <MetricCard label="Paid book finishes" value={fable.totals.paidFinishes} subtitle={change('paidFinishes')} />
          <MetricCard label="Printed copies sold" value={fable.totals.printedCopies} subtitle={change('printedCopies')} />
          <MetricCard label="Revenue collected" value={cash(fable.totals.revenueCents)} subtitle={change('revenueCents')} />
        </div>
        <div className="business-secondary"><span>{fable.totals.subscriptionFinishes} subscription finishes</span><span>{fable.totals.complimentaryFinishes} complimentary finishes</span><span>Provider spend {cash(fable.totals.providerSpendCents)}</span><span>Recorded margin {cash(fable.totals.marginCents)}</span></div>
        {fable.timeseries.length > 1 ? <div className="chart-container"><h3>New books</h3><ResponsiveContainer width="100%" height={220}><AreaChart data={fable.timeseries}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="date" tickFormatter={value => value.slice(5)} stroke="var(--text-secondary)" /><YAxis allowDecimals={false} stroke="var(--text-secondary)" /><Tooltip contentStyle={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }} /><Area type="linear" dataKey="booksCreated" name="Books created" stroke="var(--accent-green)" fill="var(--accent-green)" fillOpacity={0.15} /></AreaChart></ResponsiveContainer></div> : null}
        <details className="business-definitions"><summary>What these figures count</summary>{Object.values(fable.definitions).map(text => <p key={text}>{text}</p>)}{fable.caveats.map((text, index) => <p key={index}>{text}</p>)}</details>
      </> : <p>{data.fableReason}</p>}
    </section>
    {data.apps.map(app => <section className="section" key={app.project}><h2>{app.name}</h2><div className="business-stores">{app.stores.map(store => <div className="business-store" key={store.store}>
      <h3>{STORE_LABELS[store.store]}</h3>
      <div className="business-downloads">{store.downloads === null ? '—' : store.downloads.toLocaleString()}<span>{store.store === 'google' ? 'user installs' : 'new downloads'}</span></div>
      <p>{store.latest ? `${store.timeseries[0].date}–${store.latest.date} · ${store.reportingTimezone}` : 'Awaiting a store report'}</p>
      {!store.complete ? <p className="business-freshness">Some reporting dates are not available yet.</p> : null}
      {store.recordedSince ? <p>{store.recordedDownloads?.toLocaleString()} recorded since {store.recordedSince}</p> : null}
      {store.reason ? <p>{store.reason}</p> : null}
      {store.store === 'google' && store.latest?.activeDeviceInstalls != null ? <p>{store.latest.activeDeviceInstalls.toLocaleString()} active devices with the app installed on {store.latest.date}</p> : null}
      <p className="business-freshness">{store.store === 'apple' ? 'First acquisitions; redownloads and updates are separate.' : store.store === 'amazon' ? 'First acquisitions from sales reports. This does not count currently installed devices.' : 'Google’s daily user installs, summed over reported dates. This is not a count of unique people across the period. Active devices were online within 30 days. Exports usually arrive 3–7 days later.'}</p>
    </div>)}</div></section>)}
  </div>;
}
