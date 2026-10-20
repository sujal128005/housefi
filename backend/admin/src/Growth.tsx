// Services & prices (the catalogue customers book from), the parts price list, coupons and announcements.
import { useMemo, useState } from 'react';
import { type AdminPart, type AdminService, type Announcement, api, ApiError, type Bi, CATEGORY_IDS, type CategoryId, type Coupon, type CouponInput, rupees, TRADE_LABEL, when } from './api.ts';
import { Drawer, Empty, PageHead, Pill, SearchBox, Segmented, TableSkeleton, useActions, useLoad } from './ui.tsx';

const blankBi: Bi = { en: '', te: '' };
const errorText = (e: unknown) => (e instanceof ApiError ? (e.status === 422 ? 'Some fields are not right: check the values and try again.' : e.message) : 'Not saved: something went wrong');

/** Two inputs: English, and Telugu (optional: English is used when empty). */
function BiInput({ label, value, onChange, multiline, max = 60 }: { readonly label: string; readonly value: Bi; readonly onChange: (v: Bi) => void; readonly multiline?: boolean; readonly max?: number }) {
  return (
    <div className="bi">
      <label>{label} · English{multiline ? <textarea rows={2} maxLength={max} value={value.en} onChange={(e) => onChange({ ...value, en: e.target.value })} /> : <input maxLength={max} value={value.en} onChange={(e) => onChange({ ...value, en: e.target.value })} />}</label>
      <label>{label} · తెలుగు (optional){multiline ? <textarea rows={2} maxLength={max * 2} value={value.te} onChange={(e) => onChange({ ...value, te: e.target.value })} /> : <input maxLength={max * 2} value={value.te} onChange={(e) => onChange({ ...value, te: e.target.value })} />}</label>
    </div>
  );
}

function Num({ label, value, onChange, min = 0, suffix }: { readonly label: string; readonly value: number; readonly onChange: (n: number) => void; readonly min?: number; readonly suffix?: string }) {
  return <label>{label}<span className="num-field">{suffix === '₹' ? <em>₹</em> : null}<input type="number" min={min} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(Number.parseInt(e.target.value, 10))} />{suffix && suffix !== '₹' ? <em>{suffix}</em> : null}</span></label>;
}

function Toggle({ label, value, onChange }: { readonly label: string; readonly value: boolean; readonly onChange: (v: boolean) => void }) {
  return <label className="check"><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

// ---------- Services & prices ----------

export function ServicesPage() {
  const [tab, setTab] = useState<'SERVICES' | 'PARTS'>('SERVICES');
  return (
    <div className="page">
      <PageHead title="Services & prices" sub="What customers can book and what it costs, and the parts price list technicians quote from. Changes reach the app the next time it opens.">
        <Segmented value={tab} onChange={setTab} options={[['SERVICES', 'Services'], ['PARTS', 'Parts price list']]} />
      </PageHead>
      {tab === 'SERVICES' ? <ServiceList /> : <PartList />}
    </div>
  );
}

function ServiceList() {
  const list = useLoad(() => api.services(), []);
  const [cat, setCat] = useState<CategoryId | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<AdminService | 'NEW' | null>(null);
  const rows = (list.data ?? []).filter((s) => (cat === 'ALL' || s.categoryId === cat) && (!search || `${s.name.en} ${s.id}`.toLowerCase().includes(search.toLowerCase())));
  return (
    <>
      <div className="toolbar">
        <Segmented value={cat} onChange={setCat} options={[['ALL', 'All'], ...CATEGORY_IDS.map((c) => [c, TRADE_LABEL[c] ?? c] as const)]} />
        <SearchBox value={search} onChange={setSearch} placeholder="Find a service" />
        <button className="btn primary" onClick={() => setOpen('NEW')}>+ New service</button>
      </div>
      <div className="card flush">
        {!list.data ? <TableSkeleton /> : rows.length === 0 ? <Empty title="No services" /> : (
          <table className="table">
            <thead><tr><th>Service</th><th>Trade</th><th>Visit fee</th><th>Repair from</th><th>Usual max</th><th>Time</th><th>Problems</th><th>Bookings</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} onClick={() => setOpen(s)} className={s.active ? '' : 'dim'}>
                  <td className="strong">{s.name.en}<div className="muted small">{s.name.te}</div></td>
                  <td>{TRADE_LABEL[s.categoryId]}</td>
                  <td className="strong">{rupees(s.visitFee)}</td>
                  <td>{rupees(s.repairFrom)}</td>
                  <td>{rupees(s.repairTypicalMax)}</td>
                  <td className="muted">{s.durationMin}–{s.durationMax} min</td>
                  <td>{s.issues.length}</td>
                  <td>{s.bookings}</td>
                  <td>{s.active ? <Pill tone="done">on sale</Pill> : <Pill tone="plain">hidden</Pill>}{s.popular ? <Pill tone="brand">popular</Pill> : null}{s.editedInHq ? <Pill tone="live">set in HQ</Pill> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open ? <ServiceEditor service={open === 'NEW' ? null : open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.reload(); }} /> : null}
    </>
  );
}

function ServiceEditor({ service, onClose, onSaved }: { readonly service: AdminService | null; readonly onClose: () => void; readonly onSaved: () => void }) {
  const { toast } = useActions();
  const [v, setV] = useState(() => (service
    ? { categoryId: service.categoryId, name: service.name, description: service.description, visitFee: service.visitFee, repairFrom: service.repairFrom, repairTypicalMax: service.repairTypicalMax, durationMin: service.durationMin, durationMax: service.durationMax, popular: service.popular, active: service.active, keywords: service.keywords, issues: service.issues }
    : { categoryId: 'PLUMBING' as CategoryId, name: blankBi, description: blankBi, visitFee: 49, repairFrom: 149, repairTypicalMax: 600, durationMin: 30, durationMax: 60, popular: false, active: true, keywords: [] as readonly string[], issues: [{ name: blankBi }] as AdminService['issues'] }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((x) => ({ ...x, [k]: value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveService(service?.id ?? null, { ...v, issues: v.issues.filter((i) => i.name.en.trim()) });
      toast(service ? 'Service saved' : 'Service added');
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Drawer title={service ? service.name.en : 'New service'} sub={service ? <span className="mono">{service.id} · {service.bookings} bookings</span> : 'It goes on sale as soon as you save (if "On sale" is ticked).'} onClose={onClose} wide>
      <div className="form">
        <label>Trade<select value={v.categoryId} disabled={!!service} onChange={(e) => set('categoryId', e.target.value as CategoryId)}>{CATEGORY_IDS.map((c) => <option key={c} value={c}>{TRADE_LABEL[c]}</option>)}</select></label>
        <BiInput label="Name" value={v.name} onChange={(x) => set('name', x)} />
        <BiInput label="Description" value={v.description} onChange={(x) => set('description', x)} multiline max={300} />
        <div className="row3">
          <Num label="Visit fee (paid when booking)" value={v.visitFee} onChange={(n) => set('visitFee', n)} suffix="₹" />
          <Num label="Repair from (lowest)" value={v.repairFrom} onChange={(n) => set('repairFrom', n)} min={1} suffix="₹" />
          <Num label="Usual maximum" value={v.repairTypicalMax} onChange={(n) => set('repairTypicalMax', n)} min={1} suffix="₹" />
        </div>
        <p className="muted small hint">Price check: a quote above 1.5 × the usual maximum ({rupees(Math.round((v.repairTypicalMax || 0) * 1.5))}) is reviewed before the customer sees it. Parts from the price list at their price are always fine.</p>
        <div className="row3">
          <Num label="Takes from" value={v.durationMin} onChange={(n) => set('durationMin', n)} min={5} suffix="min" />
          <Num label="Takes up to" value={v.durationMax} onChange={(n) => set('durationMax', n)} min={5} suffix="min" />
          <label>Search words (comma separated)<input value={v.keywords.join(', ')} onChange={(e) => set('keywords', e.target.value.split(','))} /></label>
        </div>
        <div className="row-checks">
          <Toggle label="On sale" value={v.active} onChange={(x) => set('active', x)} />
          <Toggle label="Popular (shown first)" value={v.popular} onChange={(x) => set('popular', x)} />
        </div>
        <div className="issues">
          <div className="issues-head"><b>Problems customers pick</b><button className="btn small" onClick={() => set('issues', [...v.issues, { name: blankBi }])}>+ Add</button></div>
          {v.issues.map((i, k) => (
            <div key={i.id ?? `new-${k}`} className="issue-row">
              <input placeholder="English" maxLength={60} value={i.name.en} onChange={(e) => set('issues', v.issues.map((x, j) => (j === k ? { ...x, name: { ...x.name, en: e.target.value } } : x)))} />
              <input placeholder="తెలుగు (optional)" maxLength={120} value={i.name.te} onChange={(e) => set('issues', v.issues.map((x, j) => (j === k ? { ...x, name: { ...x.name, te: e.target.value } } : x)))} />
              <button className="btn small danger-outline" disabled={v.issues.length <= 1} onClick={() => set('issues', v.issues.filter((_, j) => j !== k))} aria-label="Remove">×</button>
            </div>
          ))}
        </div>
        {error ? <div className="alert">{error}</div> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Back</button>
          <button className="btn primary" disabled={busy || v.name.en.trim().length < 3} onClick={() => void save()}>{busy ? 'Saving…' : service ? 'Save changes' : 'Add service'}</button>
        </div>
      </div>
    </Drawer>
  );
}

// ---------- Parts price list ----------

function PartList() {
  const list = useLoad(() => api.parts(), []);
  const services = useLoad(() => api.services(), []);
  const [cat, setCat] = useState<CategoryId>('PLUMBING');
  const [open, setOpen] = useState<AdminPart | 'NEW' | null>(null);
  const rows = (list.data ?? []).filter((p) => p.categoryId === cat);
  return (
    <>
      <div className="toolbar">
        <Segmented value={cat} onChange={setCat} options={CATEGORY_IDS.map((c) => [c, TRADE_LABEL[c] ?? c] as const)} />
        <button className="btn primary" onClick={() => setOpen('NEW')}>+ New part</button>
      </div>
      <p className="muted small">Technicians pick these while quoting. A part at its listed price (up to 10% more) always passes the price check, so fair quotes reach customers faster.</p>
      <div className="card flush">
        {!list.data ? <TableSkeleton /> : rows.length === 0 ? <Empty title="No parts for this trade" /> : (
          <table className="table">
            <thead><tr><th>Part</th><th>Unit</th><th>Standard price</th><th>For</th><th>Used in quotes</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} onClick={() => setOpen(p)} className={p.active ? '' : 'dim'}>
                  <td className="strong">{p.name.en}{p.name.te !== p.name.en ? <div className="muted small">{p.name.te}</div> : null}</td>
                  <td className="muted">{p.unit}</td>
                  <td className="strong">{rupees(p.price)}</td>
                  <td className="muted">{p.serviceId ?? 'whole trade'}</td>
                  <td>{p.used}</td>
                  <td>{p.active ? <Pill tone="done">listed</Pill> : <Pill tone="plain">hidden</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open ? <PartEditor part={open === 'NEW' ? null : open} categoryId={cat} services={(services.data ?? []).filter((s) => s.categoryId === cat)} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.reload(); }} /> : null}
    </>
  );
}

function PartEditor({ part, categoryId, services, onClose, onSaved }: { readonly part: AdminPart | null; readonly categoryId: CategoryId; readonly services: readonly AdminService[]; readonly onClose: () => void; readonly onSaved: () => void }) {
  const { toast } = useActions();
  const [v, setV] = useState(() => (part ? { categoryId: part.categoryId, serviceId: part.serviceId, name: part.name, unit: part.unit, price: part.price, active: part.active, sort: part.sort } : { categoryId, serviceId: null as string | null, name: blankBi, unit: 'piece', price: 100, active: true, sort: 0 }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.savePart(part?.id ?? null, v);
      toast(part ? 'Part saved' : 'Part added');
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide form">
        <h2>{part ? part.name.en : `New ${TRADE_LABEL[categoryId]} part`}</h2>
        <BiInput label="Name" value={v.name} onChange={(name) => setV({ ...v, name })} />
        <div className="row3">
          <Num label="Standard price" value={v.price} onChange={(price) => setV({ ...v, price })} min={1} suffix="₹" />
          <label>Unit<select value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })}>{['piece', 'set', 'pair', 'metre', 'roll', 'kg', 'litre', 'pack'].map((u) => <option key={u}>{u}</option>)}</select></label>
          <label>For<select value={v.serviceId ?? ''} onChange={(e) => setV({ ...v, serviceId: e.target.value || null })}><option value="">Whole trade</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name.en}</option>)}</select></label>
        </div>
        <Toggle label="Listed (technicians can pick it)" value={v.active} onChange={(active) => setV({ ...v, active })} />
        {error ? <div className="alert">{error}</div> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Back</button>
          <button className="btn primary" disabled={busy || v.name.en.trim().length < 2} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Coupons ----------

const toDay = (ms: number | null) => (ms ? new Date(ms + 330 * 60_000).toISOString().slice(0, 10) : '');
const fromDay = (s: string, endOfDay = false) => (s ? Date.parse(`${s}T${endOfDay ? '23:59:59' : '00:00:00'}+05:30`) : null);

export function CouponsPage() {
  const list = useLoad(() => api.coupons(), []);
  const [open, setOpen] = useState<Coupon | 'NEW' | null>(null);
  const totals = useMemo(() => (list.data ?? []).reduce((a, c) => ({ uses: a.uses + c.uses, given: a.given + c.discountGiven }), { uses: 0, given: 0 }), [list.data]);
  const status = (c: Coupon) => {
    const now = Date.now();
    if (!c.active) return <Pill tone="plain">switched off</Pill>;
    if (c.validTo && c.validTo < now) return <Pill tone="stop">expired</Pill>;
    if (c.validFrom && c.validFrom > now) return <Pill tone="wait">starts {toDay(c.validFrom)}</Pill>;
    if (c.maxUses !== null && c.uses >= c.maxUses) return <Pill tone="stop">used up</Pill>;
    return <Pill tone="done">live</Pill>;
  };
  return (
    <div className="page">
      <PageHead title="Coupons" sub={`Customers type a code on their final bill. Housefi pays the discount; technicians earn the same. ${totals.uses} uses so far, ${rupees(totals.given)} given.`}>
        <button className="btn primary" onClick={() => setOpen('NEW')}>+ New coupon</button>
      </PageHead>
      <div className="card flush">
        {!list.data ? <TableSkeleton rows={4} /> : list.data.length === 0 ? <Empty title="No coupons yet">Make one, e.g. FIRST50 for ₹50 off the first booking.</Empty> : (
          <table className="table">
            <thead><tr><th>Code</th><th>Discount</th><th>Rules</th><th>Valid</th><th>Uses</th><th>Given</th><th>Status</th></tr></thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} onClick={() => setOpen(c)}>
                  <td><span className="coupon-code">{c.code}</span><div className="muted small">{c.description}</div></td>
                  <td className="strong">{c.kind === 'FLAT' ? `${rupees(c.value)} off` : `${c.value}% off`}{c.kind === 'PERCENT' && c.maxDiscount ? <div className="muted small">up to {rupees(c.maxDiscount)}</div> : null}</td>
                  <td className="muted small">{[c.minBill ? `bill ≥ ${rupees(c.minBill)}` : '', c.firstBookingOnly ? 'first booking only' : '', `${c.perCustomer}× per customer`].filter(Boolean).join(' · ')}</td>
                  <td className="muted small">{c.validFrom || c.validTo ? `${toDay(c.validFrom) || 'now'} → ${toDay(c.validTo) || 'no end'}` : 'always'}</td>
                  <td>{c.uses}{c.maxUses !== null ? <span className="muted"> / {c.maxUses}</span> : null}</td>
                  <td>{rupees(c.discountGiven)}</td>
                  <td>{status(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open ? <CouponEditor coupon={open === 'NEW' ? null : open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.reload(); }} /> : null}
    </div>
  );
}

function CouponEditor({ coupon, onClose, onSaved }: { readonly coupon: Coupon | null; readonly onClose: () => void; readonly onSaved: () => void }) {
  const { toast } = useActions();
  const [v, setV] = useState<CouponInput>(() => coupon ?? { code: '', description: '', kind: 'FLAT', value: 50, maxDiscount: null, minBill: 0, validFrom: null, validTo: null, maxUses: null, perCustomer: 1, firstBookingOnly: false, active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveCoupon(coupon?.id ?? null, { code: v.code, description: v.description, kind: v.kind, value: v.value, maxDiscount: v.kind === 'PERCENT' ? v.maxDiscount : null, minBill: v.minBill, validFrom: v.validFrom, validTo: v.validTo, maxUses: v.maxUses, perCustomer: v.perCustomer, firstBookingOnly: v.firstBookingOnly, active: v.active });
      toast(coupon ? 'Coupon saved' : `Coupon ${v.code.toUpperCase()} is ready`);
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide form">
        <h2>{coupon ? `Coupon ${coupon.code}` : 'New coupon'}</h2>
        <div className="row3">
          <label>Code<input className="coupon-input" maxLength={20} value={v.code} disabled={!!coupon} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} placeholder="FIRST50" /></label>
          <label>Kind<select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as 'FLAT' | 'PERCENT' })}><option value="FLAT">₹ off</option><option value="PERCENT">% off</option></select></label>
          <Num label={v.kind === 'FLAT' ? 'Rupees off' : 'Percent off'} value={v.value} onChange={(value) => setV({ ...v, value })} min={1} suffix={v.kind === 'FLAT' ? '₹' : '%'} />
        </div>
        <label>Description (for HQ)<input maxLength={200} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Diwali offer for new customers" /></label>
        <div className="row3">
          {v.kind === 'PERCENT' ? <Num label="At most (₹)" value={v.maxDiscount ?? 0} onChange={(n) => setV({ ...v, maxDiscount: n > 0 ? n : null })} suffix="₹" /> : <span />}
          <Num label="Minimum bill" value={v.minBill} onChange={(minBill) => setV({ ...v, minBill: minBill || 0 })} suffix="₹" />
          <Num label="Uses per customer" value={v.perCustomer} onChange={(perCustomer) => setV({ ...v, perCustomer: perCustomer || 1 })} min={1} />
        </div>
        <div className="row3">
          <label>Starts<input type="date" value={toDay(v.validFrom)} onChange={(e) => setV({ ...v, validFrom: fromDay(e.target.value) })} /></label>
          <label>Ends (inclusive)<input type="date" value={toDay(v.validTo)} onChange={(e) => setV({ ...v, validTo: fromDay(e.target.value, true) })} /></label>
          <Num label="Total uses (0 = no limit)" value={v.maxUses ?? 0} onChange={(n) => setV({ ...v, maxUses: n > 0 ? n : null })} />
        </div>
        <div className="row-checks">
          <Toggle label="First booking only" value={v.firstBookingOnly} onChange={(firstBookingOnly) => setV({ ...v, firstBookingOnly })} />
          <Toggle label="Switched on" value={v.active} onChange={(active) => setV({ ...v, active })} />
        </div>
        <p className="muted small hint">Customers always pay at least ₹1. The discount comes off the final repair bill (not the visit fee).</p>
        {error ? <div className="alert">{error}</div> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Back</button>
          <button className="btn primary" disabled={busy || v.code.length < 3 || !v.value} onClick={() => void save()}>{busy ? 'Saving…' : 'Save coupon'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Announcements ----------

const AUDIENCE: Readonly<Record<Announcement['audience'], string>> = { CUSTOMERS: 'All customers', TECHNICIANS: 'All technicians', ALL: 'Everyone', DEMO: 'Team demo accounts (test)' };

export function AnnouncementsPage() {
  const list = useLoad(() => api.announcements(), []);
  const { confirm } = useActions();
  const [audience, setAudience] = useState<Announcement['audience']>('DEMO');
  const [title, setTitle] = useState<Bi>(blankBi);
  const [body, setBody] = useState<Bi>(blankBi);
  const ready = title.en.trim().length >= 3 && body.en.trim().length >= 3;
  const send = () => confirm({
    title: `Send to ${AUDIENCE[audience].toLowerCase()}?`,
    body: audience === 'DEMO' ? 'Only the team’s demo phones get it: a safe test.' : 'Every phone in this group gets a notification now. It cannot be taken back.',
    confirm: 'Send now',
    danger: audience !== 'DEMO',
    run: async () => {
      const r = await api.announce({ audience, title, body });
      setTitle(blankBi);
      setBody(blankBi);
      list.reload();
      return r;
    },
    done: 'Announcement sent',
  });
  return (
    <div className="page">
      <PageHead title="Announcements" sub="A notification to customers or technicians: rain warnings, festival offers, new services. Test on the demo phones first." />
      <section className="grid-2">
        <div className="card form">
          <h2>New announcement</h2>
          <label>Send to<Segmented value={audience} onChange={setAudience} options={[['DEMO', 'Demo phones'], ['CUSTOMERS', 'Customers'], ['TECHNICIANS', 'Technicians'], ['ALL', 'Everyone']]} /></label>
          <BiInput label="Title" value={title} onChange={setTitle} max={60} />
          <BiInput label="Message" value={body} onChange={setBody} multiline max={300} />
          <div className="modal-actions"><button className="btn primary" disabled={!ready} onClick={send}>Send…</button></div>
        </div>
        <div className="card phone-preview">
          <div className="muted small">Preview on a phone</div>
          <div className="notif">
            <img src="/logo.png" alt="" />
            <div><b>{title.en || 'Title'}</b><span>{body.en || 'Your message appears here.'}</span></div>
          </div>
          {title.te || body.te ? (
            <div className="notif">
              <img src="/logo.png" alt="" />
              <div><b>{title.te || title.en}</b><span>{body.te || body.en}</span></div>
            </div>
          ) : <p className="muted small">Telugu phones get the English words until you add Telugu.</p>}
        </div>
      </section>
      <div className="card flush">
        {!list.data ? <TableSkeleton rows={3} /> : list.data.length === 0 ? <Empty title="Nothing sent yet" /> : (
          <table className="table">
            <thead><tr><th>When</th><th>To</th><th>Title</th><th>Message</th><th>Phones</th><th>By</th></tr></thead>
            <tbody>{list.data.map((a) => <tr key={a.id} className="static"><td className="nowrap">{when(a.at)}</td><td>{AUDIENCE[a.audience]}</td><td className="strong">{a.title}</td><td className="muted">{a.body}</td><td>{a.recipients}</td><td>{a.by}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
