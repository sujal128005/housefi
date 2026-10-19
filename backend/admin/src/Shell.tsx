// The portal frame: sidebar sections, the top bar (who is signed in, sign out), and the warning when an account
// recovery is waiting (every admin sees it, and can cancel one they did not ask for).
import { useState, type ReactNode } from 'react';
import { api, type Me, timeLeft } from './api.ts';
import { Bookings } from './Bookings.tsx';
import { Dashboard } from './Dashboard.tsx';
import { Payouts } from './Payouts.tsx';
import { People, PersonPanel } from './People.tsx';
import { ActionsProvider } from './ui.tsx';

type Section = 'dashboard' | 'sos' | 'reports' | 'queries' | 'bookings' | 'customers' | 'technicians' | 'payouts' | 'chats' | 'analytics' | 'audit' | 'arcade';

interface NavItem {
  readonly id: Section;
  readonly label: string;
  readonly icon: ReactNode;
  /** Not built yet: shown greyed with "Soon". */
  readonly soon?: boolean;
  readonly tone?: 'danger';
}

const I = (d: string) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

const NAV: readonly { readonly title: string; readonly items: readonly NavItem[] }[] = [
  { title: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: I('M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z') }] },
  {
    title: 'Needs attention',
    items: [
      { id: 'sos', label: 'Emergency SOS', icon: I('M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'), soon: true, tone: 'danger' },
      { id: 'reports', label: 'Reports', icon: I('M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7'), soon: true },
      { id: 'queries', label: 'Queries', icon: I('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'), soon: true },
    ],
  },
  {
    title: 'Manage',
    items: [
      { id: 'bookings', label: 'Bookings', icon: I('M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z') },
      { id: 'customers', label: 'Customers', icon: I('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75') },
      { id: 'technicians', label: 'Technicians', icon: I('M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z') },
      { id: 'payouts', label: 'Payouts', icon: I('M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6') },
      { id: 'chats', label: 'Chats', icon: I('M7 8h10M7 12h6m-9 9 3.6-3H19a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16z'), soon: true },
    ],
  },
  {
    title: 'Insight',
    items: [
      { id: 'analytics', label: 'Analytics', icon: I('M3 3v18h18M7 15l4-4 4 4 5-6'), soon: true },
      { id: 'audit', label: 'Audit log', icon: I('M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'), soon: true },
      { id: 'arcade', label: 'HQ Arcade', icon: I('M6 12h4m-2-2v4m7-1h.01M18 11h.01M17.32 5H6.68a4 4 0 0 0-3.98 3.59L2 15.7A3 3 0 0 0 5 19c1 0 2-.6 2.5-1.5L9 15h6l1.5 2.5c.5.9 1.5 1.5 2.5 1.5a3 3 0 0 0 3-3.3l-.7-7.1A4 4 0 0 0 17.32 5z'), soon: true },
    ],
  },
];

export function Shell({ me, onSignedOut, onRefreshMe }: { readonly me: Me; readonly onSignedOut: () => void; readonly onRefreshMe: () => void }) {
  const [section, setSection] = useState<Section>('dashboard');
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const openBooking = (id: string) => { setPersonId(null); setBookingId(id); setSection('bookings'); };
  const go = (id: Section) => { setBookingId(null); setPersonId(null); setSection(id); };

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    onSignedOut();
  };
  const cancelRecovery = async (id: string) => {
    await api.cancelRecovery(id).catch(() => undefined);
    onRefreshMe();
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="logo-mark">H</div><div><b>Housefi</b><span>HQ</span></div></div>
        <nav>
          {NAV.map((group) => (
            <div key={group.title} className="nav-group">
              <div className="nav-title">{group.title}</div>
              {group.items.map((item) => (
                <button key={item.id} className={`nav-item${section === item.id ? ' active' : ''}${item.tone === 'danger' ? ' danger' : ''}`} disabled={item.soon}
                  onClick={() => go(item.id)} aria-current={section === item.id ? 'page' : undefined}>
                  {item.icon}<span>{item.label}</span>{item.soon ? <em>Soon</em> : null}
                </button>
              ))}
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
        {me.recoveries.map((r) => (
          <div key={r.id} className="banner warn">
            <b>Account recovery waiting for {r.displayName}.</b> A new password can be set {timeLeft(r.readyAt - Date.now())}. If {r.displayName} did not ask for it, cancel it now.
            <button className="btn small" onClick={() => void cancelRecovery(r.id)}>Cancel recovery</button>
          </div>
        ))}
        <ActionsProvider>
          {section === 'dashboard' ? <Dashboard me={me} /> : null}
          {section === 'bookings' ? <Bookings key={bookingId ?? 'list'} openId={bookingId} onOpenPerson={(id) => setPersonId(id)} /> : null}
          {section === 'customers' || section === 'technicians' ? <People key={section} role={section} openId={personId} onOpenPerson={setPersonId} onOpenBooking={openBooking} /> : null}
          {section === 'bookings' && personId ? <PersonOverlay id={personId} onClose={() => setPersonId(null)} onOpenBooking={openBooking} /> : null}
          {section === 'payouts' ? <Payouts /> : null}
        </ActionsProvider>
      </main>
    </div>
  );
}

/** A person opened from a booking: the same panel, over the bookings list. */
function PersonOverlay({ id, onClose, onOpenBooking }: { readonly id: string; readonly onClose: () => void; readonly onOpenBooking: (id: string) => void }) {
  return <PersonPanel id={id} onClose={onClose} onChanged={() => undefined} onOpenBooking={onOpenBooking} />;
}
