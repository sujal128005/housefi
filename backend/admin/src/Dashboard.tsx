// The dashboard: what needs attention first, then today and this week, the last 14 days, and people. Refreshes itself.
import { useEffect, useState } from 'react';
import { api, ApiError, type Me, type Overview, rupees } from './api.ts';
import type { Section } from './Shell.tsx';

function greet(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard({ me, onGo }: { readonly me: Me; readonly onGo: (s: Section) => void }) {
  const [o, setO] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => api.overview().then((x) => {
      if (alive) {
        setO(x);
        setFailed(false);
      }
    }, (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) window.dispatchEvent(new Event('hq:signed-out'));
      else if (alive) setFailed(true);
    });
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{greet()}, {me.displayName.split(' ')[0]}</h1>
          <p className="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · live, refreshes every 30 s</p>
        </div>
      </header>
      {failed && !o ? <div className="alert">Couldn't load the numbers. Retrying…</div> : null}
      {!o ? <div className="skeleton-grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" />)}</div> : (
        <>
          <section className="attention">
            <Attention label="Emergency SOS" value={o.attention.openSos} tone="danger" hint="open now" onClick={() => onGo('sos')} />
            <Attention label="Reports" value={o.attention.openReports} tone="warn" hint="open" onClick={() => onGo('reports')} />
            <Attention label="Queries" value={o.attention.openQueries} tone="info" hint="call-backs waiting" onClick={() => onGo('queries')} />
            <Attention label="Profiles to review" value={o.people.waitingReview} tone="info" hint="technicians" onClick={() => onGo('technicians')} />
          </section>
          <section className="kpis">
            <Kpi label="Bookings today" value={String(o.today.bookings)} sub={`${o.week.bookings} this week`} />
            <Kpi label="Completed today" value={String(o.today.completed)} sub={`${o.week.completed} this week`} />
            <Kpi label="Revenue today" value={rupees(o.today.revenue)} sub={`${rupees(o.week.revenue)} this week`} accent />
            <Kpi label="Live now" value={String(o.now.activeBookings)} sub={`${o.now.searching} searching · ${o.now.techniciansOnline} technicians online`} />
          </section>
          <section className="grid-2">
            <div className="card">
              <div className="card-head"><h2>Last 14 days</h2><div className="legend"><i className="dot a" />Bookings<i className="dot b" />Completed</div></div>
              <Bars days={o.daily} />
            </div>
            <div className="card people">
              <h2>People</h2>
              <Stat label="Customers" value={o.people.customers} sub={`+${o.week.newCustomers} this week`} />
              <Stat label="Technicians" value={o.people.technicians} sub={`${o.people.approved} approved`} />
              <Stat label="Online now" value={o.now.techniciansOnline} />
              <Stat label="Average rating (30 days)" value={o.rating ?? '–'} sub={o.rating ? '★ out of 5' : 'no ratings yet'} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Attention({ label, value, tone, hint, onClick }: { label: string; value: number; tone: 'danger' | 'warn' | 'info'; hint: string; onClick: () => void }) {
  return (
    <button className={`attn ${tone}${value > 0 ? ' on' : ''}`} onClick={onClick}>
      <div className="attn-value">{value}</div>
      <div><b>{label}</b><span>{hint}</span></div>
      <span className="attn-go" aria-hidden="true">→</span>
    </button>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={`card kpi${accent ? ' accent' : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{sub}</small>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="stat"><span>{label}</span><b>{value}</b>{sub ? <small>{sub}</small> : null}</div>
  );
}

/** Two bars a day (bookings, completed), drawn as SVG: no chart library needed here. */
function Bars({ days }: { days: Overview['daily'] }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.bookings, d.completed)));
  const W = 640;
  const H = 220;
  const step = W / days.length;
  const bw = step * 0.32;
  return (
    <svg className="bars" viewBox={`0 0 ${W} ${H + 28}`} role="img" aria-label="Bookings and completed jobs per day, last 14 days">
      {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1="0" x2={W} y1={H - H * f} y2={H - H * f} className="gridline" />)}
      {days.map((d, i) => {
        const x = i * step + step * 0.16;
        const hb = (d.bookings / max) * (H - 8);
        const hc = (d.completed / max) * (H - 8);
        return (
          <g key={d.date}>
            <rect x={x} y={H - hb} width={bw} height={hb} rx="4" className="bar-a"><title>{`${d.date}: ${d.bookings} bookings`}</title></rect>
            <rect x={x + bw + 3} y={H - hc} width={bw} height={hc} rx="4" className="bar-b"><title>{`${d.date}: ${d.completed} completed, ${rupees(d.revenue)}`}</title></rect>
            {i % 2 === 0 ? <text x={x + bw} y={H + 20} className="axis" textAnchor="middle">{d.date.slice(8)}/{d.date.slice(5, 7)}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}
