// Bookings: every booking with filters and search by code; one booking in the side panel with its full story and every
// action (cancel with or without refund, send back, give to a technician, mark done, waive the fee, erase); and a new
// booking for a customer who phoned.
import { useState } from 'react';
import { api, type BookingDetail, type CatalogService, rupees, STATUS_LABEL, when, ago, type PersonRow, type Address } from './api.ts';
import { Drawer, Empty, Facts, PageHead, Pager, Phone, Pill, SearchBox, Segmented, StatusPill, TableSkeleton, useActions, useDebounced, useLoad } from './ui.tsx';

type Filter = 'ACTIVE' | 'SEARCHING' | 'FINISHED' | 'CANCELLED' | 'ALL';

export function Bookings({ openId, onOpenPerson }: { readonly openId?: string | null; readonly onOpenPerson: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const list = useLoad(() => api.bookings({ status: filter, search: q.replace(/^HF-?/i, ''), page }), [filter, q, page], 20_000);

  return (
    <div className="page">
      <PageHead title="Bookings" sub="Every booking, live. Click one for its full story and actions.">
        <button className="btn primary" onClick={() => setCreating(true)}>+ New booking</button>
      </PageHead>
      <div className="toolbar">
        <Segmented value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[['ACTIVE', 'Active'], ['SEARCHING', 'Searching'], ['FINISHED', 'Finished'], ['CANCELLED', 'Cancelled'], ['ALL', 'All']]} />
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Booking code, e.g. HF-48291" />
      </div>
      <div className="card flush">
        {!list.data ? <TableSkeleton /> : list.data.rows.length === 0 ? <Empty title="No bookings here">Try another filter.</Empty> : (
          <table className="table">
            <thead><tr><th>Code</th><th>Status</th><th>Service</th><th>Customer</th><th>Technician</th><th>Area</th><th>When</th><th>Visit fee</th></tr></thead>
            <tbody>
              {list.data.rows.map((b) => (
                <tr key={b.id} onClick={() => setOpen(b.id)} className={open === b.id ? 'selected' : ''}>
                  <td className="mono strong">{b.code}{b.demo ? <Pill tone="plain">demo</Pill> : null}</td>
                  <td><StatusPill status={b.status} /></td>
                  <td>{b.serviceId}</td>
                  <td>{b.customer.name || <span className="muted">–</span>}</td>
                  <td>{b.technician?.name ?? <span className="muted">–</span>}</td>
                  <td className="muted">{b.area}</td>
                  <td>{b.time.mode === 'SCHEDULED' && b.time.date ? `${b.time.date.slice(8)}/${b.time.date.slice(5, 7)} · ${b.time.startHour}:00` : 'Now'}<div className="muted small">{ago(b.createdAt)}</div></td>
                  <td>{b.visitFee ? <>{rupees(b.visitFee.amount)} <span className="muted small">{b.visitFee.state.toLowerCase()}</span></> : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list.data ? <Pager page={page} total={list.data.total} onPage={setPage} /> : null}
      {open ? <BookingPanel id={open} onClose={() => setOpen(null)} onChanged={list.reload} onOpenPerson={onOpenPerson} /> : null}
      {creating ? <NewBooking onClose={() => setCreating(false)} onMade={(id) => { setCreating(false); list.reload(); setOpen(id); }} /> : null}
    </div>
  );
}

function BookingPanel({ id, onClose, onChanged, onOpenPerson }: { readonly id: string; readonly onClose: () => void; readonly onChanged: () => void; readonly onOpenPerson: (id: string) => void }) {
  const d = useLoad(() => api.booking(id), [id], 15_000);
  const { confirm } = useActions();
  const [assigning, setAssigning] = useState(false);
  const after = () => { d.reload(); onChanged(); };
  const b = d.data;

  return (
    <Drawer title={b ? <span className="mono">{b.booking.code}</span> : 'Booking'} sub={b ? <><StatusPill status={b.booking.status} /> {b.booking.demo ? <Pill tone="plain">demo</Pill> : null}</> : null} onClose={onClose} wide>
      {!b ? (d.error ? <div className="alert">{d.error}</div> : <TableSkeleton rows={6} />) : (
        <>
          <div className="actions-row">
            {b.can.waiveFee ? <button className="btn" onClick={() => confirm({ title: 'Waive the visit fee?', body: 'Housefi pays the visit fee: the search for a technician starts now. It is not counted as revenue.', confirm: 'Waive and start', run: () => api.waiveFee(id), done: 'Visit fee waived, searching now' })}>Waive visit fee</button> : null}
            {b.can.assign ? <button className="btn" onClick={() => setAssigning(true)}>Give to a technician</button> : null}
            {b.can.sendBack ? <button className="btn" onClick={() => confirm({ title: 'Send back to the search?', body: `${b.technician?.name ?? 'The technician'} loses this job and it is offered to the next technician now.`, confirm: 'Send back', run: () => api.sendBack(id), done: 'Sent back to the search' })}>Send back to search</button> : null}
            {b.can.complete ? <button className="btn" onClick={() => confirm({ title: 'Mark as done?', body: 'Use when the work was finished but not closed in the app. Earnings are written as for any completed job.', confirm: 'Mark done', run: () => api.complete(id), done: 'Marked as done' })}>Mark done</button> : null}
            {b.can.cancel ? <button className="btn danger-outline" onClick={() => confirm({
              title: `Cancel ${b.booking.code}?`,
              body: 'The customer and the technician are told at once. This cannot be undone.',
              confirm: 'Cancel booking',
              danger: true,
              check: { label: `Refund the visit fee (${rupees(b.booking.visitPayment.amount)}, if it was paid)`, initial: true },
              reason: { label: 'Why (kept in the audit log)', required: true },
              run: ({ reason, checked }) => api.cancelBooking(id, checked, reason),
              done: 'Booking cancelled',
            })}>Cancel booking</button> : null}
            <button className="btn danger-outline" onClick={() => confirm({
              title: 'Erase this booking?',
              body: 'The address, notes, voice note, photos and chat are deleted for good (it is cancelled first if still running). Payments and the history stay.',
              confirm: 'Erase',
              danger: true,
              typeToConfirm: 'ERASE',
              run: () => api.erase(id),
              done: 'Booking erased',
            })}>Erase</button>
          </div>

          <section className="panel-grid">
            <div className="mini-card">
              <h3>Customer</h3>
              <button className="link inline strong" onClick={() => onOpenPerson(b.customer.id)}>{b.customer.name || 'No name'}</button>
              <div><Phone value={b.customer.phone} /></div>
            </div>
            <div className="mini-card">
              <h3>Technician</h3>
              {b.technician ? <><button className="link inline strong" onClick={() => onOpenPerson(b.technician!.id)}>{b.technician.name}</button><div><Phone value={b.technician.phone} /></div></> : <span className="muted">Not assigned</span>}
              {b.booking.etaMin ? <div className="muted small">Arriving in about {b.booking.etaMin} min</div> : null}
            </div>
          </section>

          <Facts rows={[
            ['Service', b.booking.serviceId],
            ['Problem', <>{b.booking.problem.issueIds.join(', ') || '–'}{b.booking.problem.notes ? <div className="muted">“{b.booking.problem.notes}”</div> : null}{b.booking.problem.voiceNote?.transcript ? <div className="muted">Voice: “{b.booking.problem.voiceNote.transcript}”</div> : null}</>],
            ['Address', b.booking.address.house ? <>{b.booking.address.house}, {b.booking.address.street}{b.booking.address.landmark ? ` (near ${b.booking.address.landmark})` : ''}, {b.booking.address.city} {b.booking.address.pincode}{b.booking.address.lat ? <> · <a href={`https://www.google.com/maps?q=${b.booking.address.lat},${b.booking.address.lng}`} target="_blank" rel="noreferrer noopener">map</a></> : null}</> : <span className="muted">Erased</span>],
            ['Time', b.booking.time.mode === 'SCHEDULED' ? `${b.booking.time.window.date}, ${b.booking.time.window.startHour}:00–${b.booking.time.window.endHour}:00` : 'As soon as possible'],
            ['Visit fee', `${rupees(b.booking.visitPayment.amount)} · ${b.booking.visitPayment.state.toLowerCase()}${b.booking.visitPayment.method ? ` (${b.booking.visitPayment.method})` : ''}`],
            ['Repair', b.booking.finalPayment ? `${rupees(b.booking.finalPayment.amount)} · ${b.booking.finalPayment.state.toLowerCase()}` : b.booking.quote ? `Quote ${rupees(b.booking.quote.total)}` : '–'],
            ['Rating', b.booking.rating ? `${'★'.repeat(b.booking.rating.stars)}${'☆'.repeat(5 - b.booking.rating.stars)}` : '–'],
            ['Chat', `${b.chatMessages} message${b.chatMessages === 1 ? '' : 's'}`],
          ]} />

          {b.booking.problem.photos.some((p) => p.url) ? (
            <div className="photos">{b.booking.problem.photos.filter((p) => p.url).map((p) => <a key={p.id} href={p.url} target="_blank" rel="noreferrer noopener"><img src={p.url} alt="Problem photo" /></a>)}</div>
          ) : null}

          {b.tickets.length ? (
            <section>
              <h3>Tickets</h3>
              {b.tickets.map((t) => <div key={t.id} className="ticket-line"><Pill tone={t.kind === 'UNSAFE' ? 'stop' : 'wait'}>{t.kind}</Pill> {t.note || <span className="muted">no note</span>} <span className="muted small">{t.state.toLowerCase()} · {ago(t.at)}</span></div>)}
            </section>
          ) : null}

          <section>
            <h3>History</h3>
            <ol className="timeline">
              {b.events.map((e, i) => (
                <li key={i} className={e.forced ? 'forced' : ''}>
                  <b>{STATUS_LABEL[e.status]}</b>
                  <span className="muted small">{when(e.at)} · by {e.actorType.toLowerCase()}{e.forced ? ' · forced by HQ' : ''}</span>
                </li>
              ))}
            </ol>
          </section>
          {assigning ? <AssignBox bookingId={id} onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); after(); }} /> : null}
        </>
      )}
    </Drawer>
  );
}

/** Pick an approved technician (searchable) for a job that is searching. */
function AssignBox({ bookingId, onClose, onDone }: { readonly bookingId: string; readonly onClose: () => void; readonly onDone: () => void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const techs = useLoad(() => api.people('technicians', { filter: 'APPROVED', search: q }), [q]);
  const { toast } = useActions();
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (t: PersonRow) => {
    setBusy(t.id);
    try {
      await api.assign(bookingId, t.id);
      toast(`Given to ${t.name}`);
      onDone();
    } catch (e) {
      toast(`Not done: ${(e as Error).message}`, 'error');
      setBusy(null);
    }
  };
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <h2>Give this job to…</h2>
        <SearchBox value={search} onChange={setSearch} placeholder="Name or phone" />
        <div className="pick-list">
          {!techs.data ? <TableSkeleton rows={4} /> : techs.data.rows.length === 0 ? <Empty title="No approved technician found" /> : techs.data.rows.map((t) => (
            <button key={t.id} className="pick" disabled={!!busy} onClick={() => void pick(t)}>
              <span className={`dot-status ${t.online ? 'on' : ''}`} />
              <b>{t.name}</b>
              <span className="muted small">{(t.trades ?? []).join(', ')} · {t.jobsDone ?? 0} jobs{t.rating ? ` · ★ ${t.rating.toFixed(1)}` : ''}</span>
              <span className="muted small">{busy === t.id ? 'Giving…' : t.online ? 'Online' : 'Offline'}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions"><button className="btn" onClick={onClose}>Back</button></div>
      </div>
    </div>
  );
}

/** A booking for a customer (e.g. one who phoned): their saved address, a service and issue, now or a slot. */
function NewBooking({ onClose, onMade }: { readonly onClose: () => void; readonly onMade: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [customer, setCustomer] = useState<PersonRow | null>(null);
  const customers = useLoad(() => (q.length >= 2 ? api.people('customers', { search: q }) : Promise.resolve({ rows: [], total: 0 })), [q]);
  const addresses = useLoad<Address[]>(() => (customer ? api.addresses(customer.id) : Promise.resolve([])), [customer?.id]);
  const catalog = useLoad<CatalogService[]>(() => api.catalog(), []);
  const [addressId, setAddressId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'INSTANT' | 'SCHEDULED'>('INSTANT');
  const [date, setDate] = useState('');
  const [hour, setHour] = useState(10);
  const [waive, setWaive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const service = catalog.data?.find((s) => s.id === serviceId);
  const ready = !!customer && !!addressId && !!serviceId && (issues.length > 0 || notes.trim().length > 0) && (mode === 'INSTANT' || !!date);

  const make = async () => {
    if (!customer) return;
    setBusy(true);
    setError(null);
    try {
      const booking = {
        serviceId,
        problem: { issueIds: issues, notes: notes.trim(), voiceNote: null, photos: [] },
        addressId,
        time: mode === 'INSTANT' ? { mode, window: null } : { mode, window: { date, startHour: hour, endHour: hour + 2 } },
        preferWomenRated: false,
      };
      const made = await api.createBooking(customer.id, booking, waive);
      onMade(made.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Drawer title="New booking" sub="For a customer who phoned or needs help booking" onClose={onClose}>
      <div className="form">
        <label>Customer
          {customer ? (
            <div className="chosen"><b>{customer.name}</b> <span className="muted">+91 ••••••{customer.phone.slice(-4)}</span><button className="link inline" onClick={() => { setCustomer(null); setAddressId(''); }}>change</button></div>
          ) : (
            <>
              <SearchBox value={search} onChange={setSearch} placeholder="Name or phone" />
              <div className="pick-list short">{customers.data?.rows.map((c) => <button key={c.id} className="pick" onClick={() => setCustomer(c)}><b>{c.name || 'No name'}</b><span className="muted small">+91 ••••••{c.phone.slice(-4)} · {c.bookings} bookings</span></button>)}</div>
            </>
          )}
        </label>
        {customer ? (
          <label>Address
            {addresses.data && addresses.data.length === 0 ? <span className="alert">This customer has no saved address. Ask them to add one in the app first.</span> : (
              <select value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                <option value="">Choose…</option>
                {addresses.data?.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.house}, {a.street}, {a.pincode}</option>)}
              </select>
            )}
          </label>
        ) : null}
        <label>Service
          <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setIssues([]); }}>
            <option value="">Choose…</option>
            {catalog.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.categoryId.toLowerCase()})</option>)}
          </select>
        </label>
        {service ? (
          <div className="chips">
            {service.issues.map((i) => <button key={i.id} className={`chip${issues.includes(i.id) ? ' on' : ''}`} onClick={() => setIssues((x) => (x.includes(i.id) ? x.filter((y) => y !== i.id) : [...x, i.id]))}>{i.name}</button>)}
          </div>
        ) : null}
        <label>Notes for the technician<textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What the customer said" /></label>
        <label>When
          <Segmented value={mode} onChange={setMode} options={[['INSTANT', 'As soon as possible'], ['SCHEDULED', 'A time slot']]} />
        </label>
        {mode === 'SCHEDULED' ? (
          <div className="row">
            <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label>Slot<select value={hour} onChange={(e) => setHour(Number(e.target.value))}>{[8, 10, 12, 14, 16, 18].map((h) => <option key={h} value={h}>{h}:00–{h + 2}:00</option>)}</select></label>
          </div>
        ) : null}
        <label className="check"><input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />Housefi pays the visit fee{service ? ` (${rupees(service.visitFee)})` : ''}: the search starts at once. Otherwise the customer pays it in the app.</label>
        {error ? <div className="alert">{error}</div> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Back</button>
          <button className="btn primary" disabled={!ready || busy} onClick={() => void make()}>{busy ? 'Booking…' : 'Create booking'}</button>
        </div>
      </div>
    </Drawer>
  );
}

export type { BookingDetail };
