// Customers and technicians: search by name or phone, filters, and one person in the side panel with their bookings,
// ratings and tickets, and the actions: block / unblock, sign out everywhere, delete; for technicians approve, reject,
// suspend, reinstate, take offline. The Aadhaar check is only shown (passed or not): it is the technician's own scan.
import { useState } from 'react';
import { api, ago, type PersonRow, rupees, TRADE_LABEL, type TechAction, type Verification, when } from './api.ts';
import { Drawer, Empty, Facts, PageHead, Pager, Phone, Pill, SearchBox, Segmented, StatusPill, TableSkeleton, useActions, useDebounced, useLoad } from './ui.tsx';

const VERIFY: Readonly<Record<Verification, [string, 'wait' | 'live' | 'done' | 'stop' | 'plain']>> = {
  PENDING: ['Waiting for review', 'wait'],
  APPROVED: ['Approved', 'done'],
  NEEDS_CORRECTION: ['Needs correction', 'wait'],
  REJECTED: ['Rejected', 'stop'],
  SUSPENDED: ['Suspended', 'stop'],
};

export function People({ role, onOpenBooking, openId, onOpenPerson }: { readonly role: 'customers' | 'technicians'; readonly onOpenBooking: (id: string) => void; readonly openId: string | null; readonly onOpenPerson: (id: string | null) => void }) {
  const tech = role === 'technicians';
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const q = useDebounced(search);
  const list = useLoad(() => api.people(role, { search: q, filter, page }), [role, q, filter, page], 30_000);
  const filters: readonly (readonly [string, string])[] = tech
    ? [['', 'All'], ['ONLINE', 'Online'], ['PENDING', 'Waiting'], ['APPROVED', 'Approved'], ['SUSPENDED', 'Suspended'], ['BLOCKED', 'Blocked']]
    : [['', 'All'], ['BLOCKED', 'Blocked'], ['DELETED', 'Deleted']];

  return (
    <div className="page">
      <PageHead title={tech ? 'Technicians' : 'Customers'} sub={tech ? 'Everyone who works with Housefi. Click one for details and actions.' : 'Everyone who books with Housefi. Click one for details and actions.'} />
      <div className="toolbar">
        <Segmented value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={filters} />
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Name or phone number" />
      </div>
      <div className="card flush">
        {!list.data ? <TableSkeleton /> : list.data.rows.length === 0 ? <Empty title="Nobody here">Try another filter or search.</Empty> : (
          <table className="table">
            <thead>
              {tech
                ? <tr><th>Name</th><th>Phone</th><th>Status</th><th>Trades</th><th>Jobs</th><th>Rating</th><th>Aadhaar</th><th>Joined</th></tr>
                : <tr><th>Name</th><th>Phone</th><th>Status</th><th>Bookings</th><th>Joined</th></tr>}
            </thead>
            <tbody>
              {list.data.rows.map((p) => (
                <tr key={p.id} onClick={() => onOpenPerson(p.id)} className={openId === p.id ? 'selected' : ''}>
                  <td className="strong">{tech ? <span className={`dot-status ${p.online ? 'on' : ''}`} /> : null}{p.name || <span className="muted">No name</span>}{p.demo ? <Pill tone="plain">demo</Pill> : null}</td>
                  <td className="mono muted">••••••{p.phone.slice(-4)}</td>
                  <td>{p.status !== 'ACTIVE' ? <Pill tone="stop">{p.status.toLowerCase()}</Pill> : tech && p.verification ? <Pill tone={VERIFY[p.verification][1]}>{VERIFY[p.verification][0]}</Pill> : <Pill tone="done">active</Pill>}</td>
                  {tech ? <>
                    <td>{(p.trades ?? []).map((t) => TRADE_LABEL[t] ?? t).join(', ')}</td>
                    <td>{p.jobsDone ?? 0}</td>
                    <td>{p.rating ? `★ ${p.rating.toFixed(1)}` : <span className="muted">–</span>} <span className="muted small">{p.ratingCount ? `(${p.ratingCount})` : ''}</span></td>
                    <td>{p.aadhaarChecked ? <Pill tone="done">checked</Pill> : <Pill tone="plain">not yet</Pill>}</td>
                  </> : <td>{p.bookings}</td>}
                  <td className="muted">{ago(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list.data ? <Pager page={page} total={list.data.total} onPage={setPage} /> : null}
      {openId ? <PersonPanel id={openId} onClose={() => onOpenPerson(null)} onChanged={list.reload} onOpenBooking={onOpenBooking} /> : null}
    </div>
  );
}

export function PersonPanel({ id, onClose, onChanged, onOpenBooking }: { readonly id: string; readonly onClose: () => void; readonly onChanged: () => void; readonly onOpenBooking: (id: string) => void }) {
  const d = useLoad(() => api.person(id), [id]);
  const { confirm } = useActions();
  const p = d.data?.person;
  const tech = p?.verification !== undefined;
  const wrap = (fn: () => Promise<unknown>) => async () => {
    await fn();
    d.reload();
    onChanged();
  };
  const techAction = (action: TechAction, title: string, body: string, needReason: boolean, danger = false) =>
    confirm({ title, body, confirm: title.replace(/\?$/, ''), danger, reason: { label: 'Why (kept in the audit log)', required: needReason }, run: ({ reason }) => wrap(() => api.techAction(id, action, reason))(), done: 'Done' });

  return (
    <Drawer title={p ? p.name || 'No name' : 'Loading…'} sub={p ? <>{tech ? 'Technician' : 'Customer'} · joined {when(p.createdAt)}{p.demo ? ' · demo account' : ''}</> : null} onClose={onClose} wide>
      {!d.data || !p ? (d.error ? <div className="alert">{d.error}</div> : <TableSkeleton rows={6} />) : (
        <>
          <div className="actions-row">
            {tech && p.verification === 'PENDING' ? <button className="btn primary" onClick={() => techAction('approve', 'Approve this technician?', 'They can go online and get jobs. When Aadhaar is required, approval waits for their own Aadhaar scan in the app.', false)}>Approve</button> : null}
            {tech && (p.verification === 'PENDING' || p.verification === 'NEEDS_CORRECTION') ? <button className="btn danger-outline" onClick={() => techAction('reject', 'Reject this profile?', 'For good (e.g. a forged identity). They are told in the app.', true, true)}>Reject</button> : null}
            {tech && p.verification === 'APPROVED' ? <button className="btn danger-outline" onClick={() => techAction('suspend', 'Suspend this technician?', 'Offline at once, no more jobs; their ID card QR shows "not active".', true, true)}>Suspend</button> : null}
            {tech && p.verification === 'SUSPENDED' ? <button className="btn" onClick={() => techAction('reinstate', 'Reinstate this technician?', 'Approved again; they go online themselves.', true)}>Reinstate</button> : null}
            {tech && p.online ? <button className="btn" onClick={() => techAction('offline', 'Take offline?', 'They stop getting offers until they go online again.', false)}>Take offline</button> : null}
            {p.status !== 'DELETED' ? <>
              <button className="btn" onClick={() => confirm({ title: 'Sign out everywhere?', body: 'Every phone signed in to this account is signed out (e.g. a lost phone). They sign in again with an SMS code.', confirm: 'Sign out', run: wrap(() => api.signOutPerson(id)), done: 'Signed out everywhere' })}>Sign out everywhere</button>
              {p.status === 'BLOCKED'
                ? <button className="btn" onClick={() => confirm({ title: 'Unblock?', body: 'They can sign in again.', confirm: 'Unblock', reason: { label: 'Why' }, run: ({ reason }) => wrap(() => api.block(id, false, reason))(), done: 'Unblocked' })}>Unblock</button>
                : <button className="btn danger-outline" onClick={() => confirm({ title: 'Block this account?', body: 'Signed out at once and cannot sign in until unblocked.', confirm: 'Block', danger: true, reason: { label: 'Why (kept in the audit log)', required: true }, run: ({ reason }) => wrap(() => api.block(id, true, reason))(), done: 'Blocked' })}>Block</button>}
              <button className="btn danger-outline" onClick={() => confirm({ title: 'Delete this account?', body: 'Name, phone, addresses, photos and chats are erased for good; past bookings stay without personal details. Not possible while a job is running.', confirm: 'Delete account', danger: true, typeToConfirm: 'DELETE', run: wrap(() => api.deletePerson(id)), done: 'Account deleted' })}>Delete account</button>
            </> : null}
          </div>

          <Facts rows={[
            ['Phone', <Phone value={p.phone} />],
            ['Status', p.status === 'ACTIVE' ? 'Active' : p.status === 'BLOCKED' ? 'Blocked' : 'Deleted'],
            ...(tech ? [
              ['Verification', p.verification ? VERIFY[p.verification][0] : 'No profile'] as const,
              ['Technician ID', p.techCode ?? '–'] as const,
              ['Trades', (p.trades ?? []).map((t) => TRADE_LABEL[t] ?? t).join(', ') || '–'] as const,
              ['Area', d.data.area ?? '–'] as const,
              ['Aadhaar', p.aadhaarChecked ? 'Checked by their own scan ✓' : 'Not checked yet (only the technician can scan it in the app)'] as const,
              ['Jobs done', String(p.jobsDone ?? 0)] as const,
              ['Rating', p.rating ? `★ ${p.rating.toFixed(2)} from ${p.ratingCount} ratings` : '–'] as const,
              ['Online', p.online ? 'Yes' : 'No'] as const,
            ] : [['Bookings', String(p.bookings)] as const]),
            ...(d.data.earnings ? [['Earnings', `${rupees(d.data.earnings.today)} today · ${rupees(d.data.earnings.total)} in all · ${rupees(d.data.earnings.pending)} to pay out`] as const] : []),
          ]} />

          {d.data.activeBooking ? <div className="banner info">On a booking right now. <button className="link inline" onClick={() => onOpenBooking(d.data!.activeBooking!)}>Open it</button></div> : null}

          <section>
            <h3>Recent bookings</h3>
            {d.data.recentBookings.length === 0 ? <p className="muted">None yet.</p> : (
              <table className="table compact">
                <tbody>{d.data.recentBookings.map((b) => <tr key={b.id} onClick={() => onOpenBooking(b.id)}><td className="mono">{b.code}</td><td>{b.serviceId}</td><td><StatusPill status={b.status} /></td><td className="muted">{ago(b.createdAt)}</td></tr>)}</tbody>
              </table>
            )}
          </section>
          {d.data.ratings.length ? (
            <section>
              <h3>{tech ? 'Ratings received' : 'Ratings given'}</h3>
              {d.data.ratings.map((r, i) => <div key={i} className="ticket-line"><span className="stars">{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</span> {r.comment || <span className="muted">no comment</span>} <span className="muted small">{ago(r.at)}</span></div>)}
            </section>
          ) : null}
          {d.data.tickets.length ? (
            <section>
              <h3>Tickets raised</h3>
              {d.data.tickets.map((t) => <div key={t.id} className="ticket-line"><Pill tone={t.kind === 'UNSAFE' ? 'stop' : 'wait'}>{t.kind}</Pill> <span className="muted small">{t.state.toLowerCase()} · {ago(t.at)}</span></div>)}
            </section>
          ) : null}
        </>
      )}
    </Drawer>
  );
}

export type { PersonRow };
