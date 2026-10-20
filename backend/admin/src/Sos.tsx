// Emergency SOS: who pressed it (customer or technician), the booking, the other person, and where they are, on a
// radar drawn here (no outside map service sees the portal), with one-click Google Maps and phone calls. "I'm on it"
// tells the other admin who has it; resolving needs a note of what was done.
import { useState } from 'react';
import { ago, api, type Spot, STATUS_LABEL, type Ticket, when } from './api.ts';
import { Empty, Phone, Pill, Segmented, TableSkeleton, useActions, useLoad } from './ui.tsx';

const SOURCE: Readonly<Record<Spot['source'], { label: string; tone: string }>> = {
  PHONE: { label: 'Where they pressed SOS', tone: 'sos' },
  LIVE: { label: 'Technician now (live)', tone: 'live' },
  ADDRESS: { label: 'Booking address', tone: 'home' },
};

/** Metres between two points (haversine). */
export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export function distanceText(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

const maps = (s: { lat: number; lng: number }) => `https://www.google.com/maps/search/?api=1&query=${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;

export function SosPage({ onOpenBooking, onOpenPerson }: { readonly onOpenBooking: (id: string) => void; readonly onOpenPerson: (id: string) => void }) {
  const [state, setState] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const list = useLoad(() => api.tickets('sos', state), [state], 8000);
  const open = state === 'OPEN' && (list.data?.length ?? 0) > 0;

  return (
    <div className="page">
      <div className={`sos-hero${open ? ' on' : ''}`}>
        <div className="sos-siren" aria-hidden="true"><span /><span /><b>SOS</b></div>
        <div>
          <h1>Emergency SOS</h1>
          <p>{open ? `${list.data!.length} person${list.data!.length === 1 ? '' : 's'} pressed SOS. Call them first, then whoever is with them. If anyone is in danger, call 112.` : 'Nobody needs help right now. This page refreshes every few seconds and sounds an alarm on every page when someone presses SOS.'}</p>
        </div>
        <Segmented value={state} onChange={setState} options={[['OPEN', 'Open'], ['RESOLVED', 'Resolved (30 days)']]} />
      </div>
      {!list.data ? <TableSkeleton rows={3} /> : list.data.length === 0 ? (
        <div className="card"><Empty title={state === 'OPEN' ? 'All calm' : 'None resolved recently'}>{state === 'OPEN' ? 'No open SOS.' : null}</Empty></div>
      ) : (
        <div className="sos-list">
          {list.data.map((t) => <SosCard key={t.id} t={t} onChanged={list.reload} onOpenBooking={onOpenBooking} onOpenPerson={onOpenPerson} />)}
        </div>
      )}
    </div>
  );
}

function SosCard({ t, onChanged, onOpenBooking, onOpenPerson }: { readonly t: Ticket; readonly onChanged: () => void; readonly onOpenBooking: (id: string) => void; readonly onOpenPerson: (id: string) => void }) {
  const { confirm } = useActions();
  const resolved = t.state === 'RESOLVED';
  const first = t.spots[0] ?? null;
  return (
    <article className={`sos-card${resolved ? ' done' : ''}`}>
      <header className="sos-card-head">
        <div className="sos-who">
          <div className={`sos-avatar ${t.person.role === 'TECHNICIAN' ? 'tech' : 'cust'}`}>{(t.person.name || '?').slice(0, 1)}</div>
          <div>
            <button className="link inline sos-name" onClick={() => onOpenPerson(t.person.id)}>{t.person.name || 'No name'}</button>
            <div className="muted small">{t.person.role === 'TECHNICIAN' ? 'Technician' : 'Customer'} · pressed {ago(t.createdAt)} ({when(t.createdAt)})</div>
          </div>
        </div>
        <div className="sos-state">
          {resolved ? <Pill tone="done">Resolved</Pill> : t.handledBy ? <Pill tone="live">{t.handledBy} is on it</Pill> : <Pill tone="stop">Nobody on it yet</Pill>}
        </div>
      </header>

      <div className="sos-body">
        <div className="sos-facts">
          <div className="sos-call">
            <span className="muted small">Call {t.person.name.split(' ')[0] || 'them'}</span>
            <Phone value={t.person.phone} />
          </div>
          {t.booking ? (
            <>
              <div className="sos-call">
                <span className="muted small">{t.person.role === 'TECHNICIAN' ? 'Customer' : 'Technician'}{t.booking.otherName ? `: ${t.booking.otherName}` : ''}</span>
                {t.booking.otherPhone ? <Phone value={t.booking.otherPhone} /> : <span className="muted">not assigned</span>}
              </div>
              <div className="sos-call">
                <span className="muted small">Booking</span>
                <button className="link inline mono" onClick={() => onOpenBooking(t.booking!.id)}>{t.booking.code}</button>
                <span className="muted small">{STATUS_LABEL[t.booking.status]} · {t.booking.area}</span>
              </div>
            </>
          ) : <div className="muted">Not about a booking.</div>}
          {t.note && t.note !== 'SOS' && !t.note.startsWith('SOS during visit') ? <blockquote className="sos-note">“{t.note}”</blockquote> : null}
          {resolved ? <div className="sos-resolution"><b>What was done:</b> {t.resolution}</div> : null}
        </div>
        <div className="sos-where">
          {t.spots.length ? <Radar spots={t.spots} /> : <div className="radar empty-radar"><span>No location: the phone did not share one</span></div>}
          <ul className="spot-list">
            {t.spots.map((s, i) => (
              <li key={i}>
                <i className={`spot-dot ${SOURCE[s.source].tone}`} />
                <span>{SOURCE[s.source].label}{s.at ? <span className="muted small"> · {ago(s.at)}</span> : null}{s.accuracyM ? <span className="muted small"> · ±{s.accuracyM} m</span> : null}</span>
                <a href={maps(s)} target="_blank" rel="noreferrer noopener" className="btn small">Google Maps ↗</a>
              </li>
            ))}
          </ul>
          {first && t.spots.length > 1 ? <p className="muted small">{SOURCE[first.source].label} is {distanceText(metres(first, t.spots[t.spots.length - 1]!))} from the {SOURCE[t.spots[t.spots.length - 1]!.source].label.toLowerCase()}.</p> : null}
        </div>
      </div>

      {!resolved ? (
        <footer className="sos-actions">
          {!t.handledBy ? <button className="btn primary" onClick={() => void api.takeTicket(t.id).then(onChanged)}>I'm on it</button> : null}
          <button className="btn danger" onClick={() => confirm({
            title: 'Resolve this SOS?',
            body: 'Only once everyone is safe. Write what was done: it stays in the record.',
            confirm: 'Resolve',
            reason: { label: 'What was done', required: true },
            run: async ({ reason }) => { await api.resolveTicket(t.id, reason); onChanged(); },
            done: 'SOS resolved',
          })}>Resolve</button>
        </footer>
      ) : null}
    </article>
  );
}

/**
 * Where everyone is, relative to each other: the first point in the middle, the others by direction and distance, with
 * rings for scale. Drawn locally (no map tiles from an outside server, which would learn the portal's address).
 */
export function Radar({ spots }: { readonly spots: readonly Spot[] }) {
  const centre = spots[0]!;
  const far = Math.max(150, ...spots.map((s) => metres(centre, s)));
  // Rings at a round scale that fits the farthest point.
  const steps = [100, 250, 500, 1000, 2500, 5000, 10_000, 25_000];
  const ring = steps.find((r) => r * 2 >= far) ?? far / 2;
  const R = 110;
  const px = (m: number) => (m / (ring * 2)) * R;
  const pos = (s: Spot) => {
    const dx = metres(centre, { lat: centre.lat, lng: s.lng }) * Math.sign(s.lng - centre.lng);
    const dy = metres(centre, { lat: s.lat, lng: centre.lng }) * Math.sign(s.lat - centre.lat);
    return { x: 130 + px(dx), y: 130 - px(dy) };
  };
  return (
    <svg className="radar" viewBox="0 0 260 260" role="img" aria-label="Where everyone is, relative to each other">
      <defs>
        <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#13224f" /><stop offset="100%" stopColor="#070d22" /></radialGradient>
      </defs>
      <circle cx="130" cy="130" r="128" fill="url(#radar-bg)" />
      {[1, 2].map((k) => <circle key={k} cx="130" cy="130" r={(R / 2) * k} className="radar-ring" />)}
      <line x1="130" y1="10" x2="130" y2="250" className="radar-axis" />
      <line x1="10" y1="130" x2="250" y2="130" className="radar-axis" />
      <g className="radar-sweep"><path d="M130 130 L130 12 A118 118 0 0 1 213 47 Z" /></g>
      <text x="130" y="22" className="radar-n">N</text>
      <text x={130 + R / 2} y="146" className="radar-scale" textAnchor="middle">{distanceText(ring)}</text>
      <text x={130 + R - 6} y="146" className="radar-scale" textAnchor="middle">{distanceText(ring * 2)}</text>
      {spots.map((s, i) => {
        const p = pos(s);
        return (
          <g key={i} transform={`translate(${Math.max(12, Math.min(248, p.x))} ${Math.max(12, Math.min(248, p.y))})`}>
            {s.source === 'PHONE' ? <circle r="14" className="radar-pulse" /> : null}
            <circle r="7" className={`radar-dot ${SOURCE[s.source].tone}`}><title>{SOURCE[s.source].label}</title></circle>
          </g>
        );
      })}
    </svg>
  );
}
