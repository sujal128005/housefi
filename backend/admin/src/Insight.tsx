// Analytics (trends over a chosen period) and the audit log (who did what, when, from where).
import { useState } from 'react';
import { HBars, Funnel, Heatmap, LineChart, SERIES } from './Charts.tsx';
import { api, type AuditRow, rupees, TRADE_LABEL, when } from './api.ts';
import { Empty, PageHead, Pill, SearchBox, Segmented, TableSkeleton, useDebounced, useLoad } from './ui.tsx';

const CANCEL: Readonly<Record<string, string>> = {
  PLANS_CHANGED: 'Plans changed', FIXED: 'Fixed it myself', TOO_LONG: 'Took too long', MISTAKE: 'Booked by mistake', OTHER: 'Other',
  UNPAID_EXPIRED: 'Visit fee not paid in time', UNFULFILLED_EXPIRED: 'No technician found', BY_HOUSEFI: 'Cancelled by Housefi', UNKNOWN: 'Not given',
};
const METHOD: Readonly<Record<string, string>> = { UPI: 'UPI', CARD: 'Card', NETBANKING: 'Net banking', CASH: 'Cash', WAIVED: 'Waived by Housefi', OTHER: 'Other' };
const short = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;

export function AnalyticsPage() {
  const [days, setDays] = useState<'7' | '30' | '90' | '365'>('30');
  const [demo, setDemo] = useState(false);
  const a = useLoad(() => api.analytics(Number(days), demo), [days, demo]);
  const d = a.data;
  return (
    <div className="page">
      <PageHead title="Analytics" sub="Trends across bookings, money, people and timing. India time; demo bookings left out unless you include them.">
        <label className="check inline"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />Include demo</label>
        <Segmented value={days} onChange={setDays} options={[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']]} />
      </PageHead>
      {!d ? (a.error ? <div className="alert">{a.error}</div> : <div className="skeleton-grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" />)}</div>) : (
        <>
          <section className="kpis six">
            <Tile label="Bookings" value={String(d.totals.bookings)} />
            <Tile label="Completed" value={String(d.totals.completed)} sub={`${d.totals.completionRate}% of bookings`} />
            <Tile label="Revenue" value={rupees(d.totals.revenue)} accent />
            <Tile label="Average job" value={rupees(d.totals.avgTicket)} sub="revenue per completed job" />
            <Tile label="Cancelled" value={`${d.totals.cancelRate}%`} sub="of bookings" />
            <Tile label="Time to assign" value={d.timing.avgMinToAssign === null ? '–' : `${d.timing.avgMinToAssign} min`} sub={d.timing.avgMinToComplete === null ? 'search to accept' : `${Math.round(d.timing.avgMinToComplete)} min accept to done`} />
          </section>

          <section className="grid-2">
            <div className="card">
              <div className="card-head"><h2>Bookings per day</h2></div>
              <LineChart labels={d.daily.map((x) => short(x.date))} lines={[
                { name: 'Created', color: SERIES[0], values: d.daily.map((x) => x.created) },
                { name: 'Cancelled', color: SERIES[1], values: d.daily.map((x) => x.cancelled) },
                { name: 'Completed', color: SERIES[2], values: d.daily.map((x) => x.completed) },
              ]} />
            </div>
            <div className="card">
              <div className="card-head"><h2>Funnel</h2></div>
              <Funnel steps={[{ label: 'Booked', value: d.funnel.created }, { label: 'Visit fee paid', value: d.funnel.paid }, { label: 'Technician assigned', value: d.funnel.assigned }, { label: 'Completed', value: d.funnel.completed }]} />
            </div>
          </section>

          <section className="grid-2">
            <div className="card">
              <div className="card-head"><h2>Revenue per day</h2><span className="muted small">visit fees and repairs paid (waived fees left out)</span></div>
              <LineChart labels={d.daily.map((x) => short(x.date))} lines={[{ name: 'Revenue', color: SERIES[0], values: d.daily.map((x) => x.revenue) }]} format={rupees} area />
            </div>
            <div className="card">
              <div className="card-head"><h2>New customers</h2></div>
              <LineChart labels={d.daily.map((x) => short(x.date))} lines={[{ name: 'New customers', color: SERIES[0], values: d.daily.map((x) => x.newCustomers) }]} height={200} area />
            </div>
          </section>

          <section className="grid-3">
            <div className="card">
              <div className="card-head"><h2>By service</h2></div>
              <HBars rows={d.byCategory.map((c) => ({ label: TRADE_LABEL[c.categoryId] ?? c.categoryId, value: c.bookings, sub: `${c.completed} done · ${rupees(c.revenue)}` }))} />
            </div>
            <div className="card">
              <div className="card-head"><h2>Busiest areas</h2></div>
              <HBars rows={d.topAreas.map((x) => ({ label: x.area, value: x.bookings }))} />
            </div>
            <div className="card">
              <div className="card-head"><h2>Why bookings were cancelled</h2></div>
              <HBars color={SERIES[1]} rows={d.cancelReasons.map((c) => ({ label: CANCEL[c.reason] ?? c.reason, value: c.count }))} empty="No cancellations" />
            </div>
          </section>

          <section className="grid-2">
            <div className="card">
              <div className="card-head"><h2>When people book</h2><span className="muted small">weekday × hour, India time</span></div>
              <Heatmap cells={d.heatmap} />
            </div>
            <div className="card">
              <div className="card-head"><h2>Ratings</h2></div>
              <HBars color={SERIES[3]} rows={[...d.ratings].reverse().map((r) => ({ label: `${'★'.repeat(r.stars)}`, value: r.count }))} empty="No ratings yet" />
              <div className="card-head spaced"><h2>How people paid</h2></div>
              <HBars rows={d.paymentMethods.map((m) => ({ label: METHOD[m.method] ?? m.method, value: m.count, sub: rupees(m.amount) }))} empty="No payments yet" />
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Top technicians</h2><span className="muted small">completed jobs in the period</span></div>
            {d.topTechnicians.length === 0 ? <Empty title="No completed jobs yet" /> : (
              <table className="table compact">
                <thead><tr><th>#</th><th>Technician</th><th>Jobs</th><th>Rating</th></tr></thead>
                <tbody>{d.topTechnicians.map((t, i) => <tr key={t.id} className="static"><td>{i + 1}</td><td className="strong">{t.name || '–'}</td><td>{t.jobs}</td><td>{t.rating ? `★ ${t.rating.toFixed(2)}` : '–'}</td></tr>)}</tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, accent }: { readonly label: string; readonly value: string; readonly sub?: string; readonly accent?: boolean }) {
  return <div className={`card kpi${accent ? ' accent' : ''}`}><span>{label}</span><b>{value}</b>{sub ? <small>{sub}</small> : <small>&nbsp;</small>}</div>;
}

// ---------- audit log ----------

const ACTOR_TONE: Readonly<Record<string, 'brand' | 'live' | 'plain' | 'wait' | 'done'>> = { ADMIN: 'brand', SYSTEM: 'plain', CUSTOMER: 'live', TECHNICIAN: 'done', COORDINATOR: 'wait' };

export function AuditPage() {
  const [search, setSearch] = useState('');
  const [actor, setActor] = useState('');
  const [older, setOlder] = useState<AuditRow[]>([]);
  const q = useDebounced(search);
  const first = useLoad(() => api.audit({ search: q, actor }), [q, actor]);
  const rows = [...(first.data ?? []), ...older];
  const more = async () => {
    const last = rows.at(-1);
    if (!last) return;
    setOlder([...older, ...(await api.audit({ search: q, actor, before: last.at }))]);
  };
  return (
    <div className="page">
      <PageHead title="Audit log" sub="Every sign-in, change and decision, newest first. It cannot be edited from here." />
      <div className="toolbar">
        <Segmented value={actor} onChange={(v) => { setActor(v); setOlder([]); }} options={[['', 'Everyone'], ['ADMIN', 'Super admins'], ['SYSTEM', 'Housefi (automatic)'], ['CUSTOMER', 'Customers'], ['TECHNICIAN', 'Technicians']]} />
        <SearchBox value={search} onChange={(v) => { setSearch(v); setOlder([]); }} placeholder="Action (e.g. cancel) or an id" />
      </div>
      <div className="card flush">
        {!first.data ? <TableSkeleton /> : rows.length === 0 ? <Empty title="Nothing found" /> : (
          <table className="table compact">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>On</th><th>From</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="static">
                  <td className="nowrap">{when(r.at)}</td>
                  <td><Pill tone={ACTOR_TONE[r.actorType] ?? 'plain'}>{r.actor}</Pill></td>
                  <td className="mono">{r.action}</td>
                  <td className="mono muted small">{r.entity} {r.entityId.slice(0, 8)}</td>
                  <td className="mono muted small">{r.ip ?? '–'}</td>
                  <td className="mono muted small details">{r.details === '{}' ? '' : r.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows.length >= 100 ? <div className="pager"><button className="btn small" onClick={() => void more()}>Load older</button></div> : null}
    </div>
  );
}
