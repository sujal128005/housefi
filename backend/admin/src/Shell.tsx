// The portal frame: sidebar sections with live counts, the top warnings (an open SOS on every page, with an alarm;
// an account recovery waiting), the pages, a person or booking opened from anywhere, and Sarathi floating on top.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArcadePage } from './Arcade.tsx';
import { api, type Alerts, type Me, timeLeft } from './api.ts';
import { Bookings } from './Bookings.tsx';
import { Dashboard } from './Dashboard.tsx';
import { Guide, type GuideLink } from './Guide.tsx';
import { AnnouncementsPage, CouponsPage, ServicesPage } from './Growth.tsx';
import { AnalyticsPage, AuditPage } from './Insight.tsx';
import { Payouts } from './Payouts.tsx';
import { SkillsPage } from './Skills.tsx';
import { CoursesPage } from './Courses.tsx';
import { People, PersonPanel } from './People.tsx';
import { SosPage } from './Sos.tsx';
import { ChatsPage, QueriesPage, ReportsPage } from './Support.tsx';
import { ActionsProvider, useActions } from './ui.tsx';

export type Section = 'dashboard' | 'sos' | 'reports' | 'queries' | 'bookings' | 'customers' | 'technicians' | 'skills' | 'courses' | 'payouts' | 'chats' | 'services' | 'coupons' | 'announcements' | 'analytics' | 'audit' | 'arcade';
const SECTIONS: readonly Section[] = ['dashboard', 'sos', 'reports', 'queries', 'bookings', 'customers', 'technicians', 'skills', 'courses', 'payouts', 'chats', 'services', 'coupons', 'announcements', 'analytics', 'audit', 'arcade'];

interface NavItem {
  readonly id: Section;
  readonly label: string;
  readonly icon: ReactNode;
  readonly tone?: 'danger';
  readonly count?: (a: Alerts) => number;
}

const I = (d: string) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

const NAV: readonly { readonly title: string; readonly items: readonly NavItem[] }[] = [
  { title: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: I('M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z') }] },
  {
    title: 'Needs attention',
    items: [
      { id: 'sos', label: 'Emergency SOS', icon: I('M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'), tone: 'danger', count: (a) => a.sos },
      { id: 'reports', label: 'Reports', icon: I('M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7'), count: (a) => a.reports },
      { id: 'queries', label: 'Queries', icon: I('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'), count: (a) => a.conversations + a.queries },
    ],
  },
  {
    title: 'Manage',
    items: [
      { id: 'bookings', label: 'Bookings', icon: I('M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z') },
      { id: 'customers', label: 'Customers', icon: I('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75') },
      { id: 'technicians', label: 'Technicians', icon: I('M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z') },
      { id: 'skills', label: 'Skill checks', icon: I('M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 2 9 2 12 0v-5'), count: (a) => a.skills ?? 0 },
      { id: 'courses', label: 'Courses', icon: I('M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5V4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5zM10 7l5 3-5 3z') },
      { id: 'payouts', label: 'Payouts', icon: I('M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6') },
      { id: 'chats', label: 'Chats', icon: I('M7 8h10M7 12h6m-9 9 3.6-3H19a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16z') },
    ],
  },
  {
    title: 'Grow',
    items: [
      { id: 'services', label: 'Services & prices', icon: I('M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01') },
      { id: 'coupons', label: 'Coupons', icon: I('M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1zm10-4v2m0 4v2m0 4v2') },
      { id: 'announcements', label: 'Announcements', icon: I('M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zm13-3a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14') },
    ],
  },
  {
    title: 'Insight',
    items: [
      { id: 'analytics', label: 'Analytics', icon: I('M3 3v18h18M7 15l4-4 4 4 5-6') },
      { id: 'audit', label: 'Audit log', icon: I('M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11') },
      { id: 'arcade', label: 'HQ Arcade', icon: I('M6 12h4m-2-2v4m7-1h.01M18 11h.01M17.32 5H6.68a4 4 0 0 0-3.98 3.59L2 15.7A3 3 0 0 0 5 19c1 0 2-.6 2.5-1.5L9 15h6l1.5 2.5c.5.9 1.5 1.5 2.5 1.5a3 3 0 0 0 3-3.3l-.7-7.1A4 4 0 0 0 17.32 5z') },
    ],
  },
];

/** The SOS alarm: a two-tone siren (synthesized, no files) and the tab title blinking, while an SOS is new. */
function useSosAlarm(alerts: Alerts | null) {
  const heard = useRef<number | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => {
    const newest = alerts?.newestSosAt ?? null;
    if (!alerts || alerts.sos === 0 || newest === null) return;
    if (heard.current !== null && newest <= heard.current) return;
    const first = heard.current === null;
    heard.current = newest;
    // On opening the portal an older SOS is shown, not sounded; a new one sounds.
    if (first && Date.now() - newest > 2 * 60_000) return;
    try {
      ctx.current ??= new AudioContext();
      const a = ctx.current;
      const t = a.currentTime;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'square';
      for (let i = 0; i < 6; i++) o.frequency.setValueAtTime(i % 2 ? 660 : 880, t + i * 0.35);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      g.gain.setValueAtTime(0.06, t + 2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 2.3);
    } catch {
      // The browser blocked sound (no click yet): the red banner still shows.
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Housefi HQ: Emergency SOS', { body: 'Someone pressed SOS. Open the portal now.', requireInteraction: true, tag: 'sos' });
    }
  }, [alerts]);
  useEffect(() => {
    if (!alerts?.sos) {
      document.title = 'Housefi HQ';
      return;
    }
    let on = false;
    const id = setInterval(() => {
      on = !on;
      document.title = on ? `🚨 SOS (${alerts.sos}) · Housefi HQ` : 'Housefi HQ';
    }, 1000);
    return () => {
      clearInterval(id);
      document.title = 'Housefi HQ';
    };
  }, [alerts?.sos]);
}

function sectionFromHash(): Section {
  const h = window.location.hash.replace('#', '') as Section;
  return SECTIONS.includes(h) ? h : 'dashboard';
}

export function Shell({ me, onSignedOut, onRefreshMe }: { readonly me: Me; readonly onSignedOut: () => void; readonly onRefreshMe: () => void }) {
  return (
    <ActionsProvider>
      <Frame me={me} onSignedOut={onSignedOut} onRefreshMe={onRefreshMe} />
    </ActionsProvider>
  );
}

function Frame({ me, onSignedOut, onRefreshMe }: { readonly me: Me; readonly onSignedOut: () => void; readonly onRefreshMe: () => void }) {
  const [section, setSection] = useState<Section>(sectionFromHash);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [askNotify, setAskNotify] = useState(() => 'Notification' in window && Notification.permission === 'default');
  const { toast } = useActions();
  useSosAlarm(alerts);

  // Counts and the SOS alarm: every 10 seconds, on every page.
  useEffect(() => {
    let alive = true;
    const load = () => api.alerts().then((a) => alive && setAlerts(a), () => undefined);
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // The address bar remembers the page (Back works; the hash never leaves the browser).
  useEffect(() => {
    const onHash = () => setSection(sectionFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((id: Section) => {
    setBookingId(null);
    setPersonId(null);
    setSection(id);
    if (window.location.hash !== `#${id}`) window.location.hash = id;
  }, []);
  const openBooking = useCallback((id: string) => {
    setPersonId(null);
    setBookingId(id);
    setSection('bookings');
    if (window.location.hash !== '#bookings') window.location.hash = 'bookings';
  }, []);
  const openPerson = useCallback((id: string) => setPersonId(id), []);

  /** Links in Sarathi's answers. */
  const onGuideLink = useCallback(async (l: GuideLink) => {
    if (l.kind === 'page') {
      const p = l.page.toLowerCase() as Section;
      if (SECTIONS.includes(p)) go(p);
      return;
    }
    if (l.kind === 'person') {
      setPersonId(l.id);
      return;
    }
    const digits = l.code.toUpperCase().replace(/^HF-?/, '');
    const found = await api.bookings({ status: 'ALL', search: digits }).catch(() => null);
    const row = found?.rows.find((r) => r.code === `HF-${digits}`) ?? found?.rows[0];
    if (row) openBooking(row.id);
    else toast(`No booking ${l.code}`, 'error');
  }, [go, openBooking, toast]);

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    onSignedOut();
  };
  const cancelRecovery = async (id: string) => {
    await api.cancelRecovery(id).catch(() => undefined);
    onRefreshMe();
  };

  const personOverlay = personId && section !== 'customers' && section !== 'technicians';
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><img className="logo-img" src="/logo.png" alt="Housefi" /><div><b>Housefi</b><span>HQ</span></div></div>
        <nav>
          {NAV.map((group) => (
            <div key={group.title} className="nav-group">
              <div className="nav-title">{group.title}</div>
              {group.items.map((item) => {
                const n = alerts && item.count ? item.count(alerts) : 0;
                return (
                  <button key={item.id} className={`nav-item${section === item.id ? ' active' : ''}${item.tone === 'danger' ? ' danger' : ''}${item.tone === 'danger' && n > 0 ? ' alarm' : ''}`}
                    onClick={() => go(item.id)} aria-current={section === item.id ? 'page' : undefined}>
                    {item.icon}<span>{item.label}</span>{n > 0 ? <em className={item.tone === 'danger' ? 'hot' : ''}>{n}</em> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">{me.displayName.slice(0, 1)}</div>
          <div className="who"><b>{me.displayName}</b><span>{me.username}</span></div>
          <button className="icon-btn" title="Sign out" onClick={() => void signOut()} aria-label="Sign out">{I('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9')}</button>
        </div>
      </aside>
      <main className="main">
        {alerts && alerts.sos > 0 && section !== 'sos' ? (
          <button className="sos-banner" onClick={() => go('sos')}>
            <span className="sos-banner-dot" />
            <b>EMERGENCY SOS · {alerts.sos} open</b>
            <span>Someone pressed SOS. Open it now →</span>
          </button>
        ) : null}
        {askNotify ? (
          <div className="banner info-soft">
            Get a desktop alert when someone presses SOS, even when this tab is in the background.
            <button className="btn small primary" onClick={() => void Notification.requestPermission().finally(() => setAskNotify(false))}>Turn on SOS alerts</button>
            <button className="btn small" onClick={() => setAskNotify(false)}>Not now</button>
          </div>
        ) : null}
        {me.recoveries.map((r) => (
          <div key={r.id} className="banner warn">
            <b>Account recovery waiting for {r.displayName}.</b> A new password can be set {timeLeft(r.readyAt - Date.now())}. If {r.displayName} did not ask for it, cancel it now.
            <button className="btn small" onClick={() => void cancelRecovery(r.id)}>Cancel recovery</button>
          </div>
        ))}
        {section === 'dashboard' ? <Dashboard me={me} onGo={go} /> : null}
        {section === 'sos' ? <SosPage onOpenBooking={openBooking} onOpenPerson={openPerson} /> : null}
        {section === 'reports' ? <ReportsPage onOpenBooking={openBooking} onOpenPerson={openPerson} /> : null}
        {section === 'queries' ? <QueriesPage onOpenBooking={openBooking} onOpenPerson={openPerson} /> : null}
        {section === 'bookings' ? <Bookings key={bookingId ?? 'list'} openId={bookingId} onOpenPerson={openPerson} /> : null}
        {section === 'customers' || section === 'technicians' ? <People key={section} role={section} openId={personId} onOpenPerson={setPersonId} onOpenBooking={openBooking} /> : null}
        {section === 'skills' ? <SkillsPage onOpenPerson={openPerson} /> : null}
        {section === 'courses' ? <CoursesPage /> : null}
        {section === 'payouts' ? <Payouts /> : null}
        {section === 'chats' ? <ChatsPage onOpenBooking={openBooking} /> : null}
        {section === 'services' ? <ServicesPage /> : null}
        {section === 'coupons' ? <CouponsPage /> : null}
        {section === 'announcements' ? <AnnouncementsPage /> : null}
        {section === 'analytics' ? <AnalyticsPage /> : null}
        {section === 'audit' ? <AuditPage /> : null}
        {section === 'arcade' ? <ArcadePage me={me.displayName} /> : null}
        {personOverlay ? <PersonPanel id={personId} onClose={() => setPersonId(null)} onChanged={() => undefined} onOpenBooking={openBooking} /> : null}
      </main>
      <Guide me={me.displayName} onLink={(l) => void onGuideLink(l)} />
    </div>
  );
}
