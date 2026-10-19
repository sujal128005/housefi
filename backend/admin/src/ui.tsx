// Shared portal parts: loading data, status pills, the side panel for one record, the confirm box (with a reason when
// it matters), toasts, search and filters, paging.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, type BookingStatus, STATUS_LABEL, statusTone } from './api.ts';

/** Loads with `fn` (again whenever `deps` change, and every `everyMs` when given); `reload` for after an action. */
export function useLoad<T>(fn: () => Promise<T>, deps: readonly unknown[], everyMs?: number): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fnRef.current().then(
      (x) => {
        if (!alive) return;
        setData(x);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Something went wrong');
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [...deps, tick]);

  useEffect(() => {
    if (!everyMs) return;
    const id = setInterval(() => setTick((n) => n + 1), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);

  return { data, error, loading, reload: useCallback(() => setTick((n) => n + 1), []) };
}

/** A value that settles after the user stops typing (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function StatusPill({ status }: { readonly status: BookingStatus }) {
  return <span className={`pill ${statusTone(status)}`}>{STATUS_LABEL[status]}</span>;
}

export function Pill({ tone, children }: { readonly tone: 'wait' | 'live' | 'done' | 'stop' | 'plain' | 'brand'; readonly children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function PageHead({ title, sub, children }: { readonly title: string; readonly sub?: ReactNode; readonly children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="muted">{sub}</p> : null}
      </div>
      {children ? <div className="head-actions">{children}</div> : null}
    </header>
  );
}

export function SearchBox({ value, onChange, placeholder }: { readonly value: string; readonly onChange: (v: string) => void; readonly placeholder: string }) {
  return (
    <div className="search">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value ? <button className="clear" onClick={() => onChange('')} aria-label="Clear">×</button> : null}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { readonly value: T; readonly options: readonly (readonly [T, string])[]; readonly onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export function Pager({ page, total, size = 50, onPage }: { readonly page: number; readonly total: number; readonly size?: number; readonly onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return <div className="pager muted">{total} in all</div>;
  return (
    <div className="pager">
      <span className="muted">{total} in all · page {page + 1} of {pages}</span>
      <button className="btn small" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button>
      <button className="btn small" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

export function Empty({ title, children }: { readonly title: string; readonly children?: ReactNode }) {
  return (
    <div className="empty">
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 7h18M5 7l1 13h12l1-13M9 7V4h6v3" /></svg>
      <b>{title}</b>
      {children ? <span>{children}</span> : null}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { readonly rows?: number }) {
  return <div className="table-skeleton">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton line" />)}</div>;
}

/** The panel that slides in from the right for one record; Esc or the backdrop closes it. */
export function Drawer({ title, sub, onClose, children, wide }: { readonly title: ReactNode; readonly sub?: ReactNode; readonly onClose: () => void; readonly children: ReactNode; readonly wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`drawer${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {sub ? <div className="muted small">{sub}</div> : null}
          </div>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export interface ConfirmSpec {
  readonly title: string;
  readonly body: ReactNode;
  readonly confirm: string;
  readonly danger?: boolean;
  /** Ask why (kept in the audit log). */
  readonly reason?: { readonly label: string; readonly required?: boolean };
  /** A checkbox, e.g. "Refund the visit fee". */
  readonly check?: { readonly label: string; readonly initial: boolean };
  /** Type this word to enable the button (erasing, deleting). */
  readonly typeToConfirm?: string;
  readonly run: (input: { reason: string; checked: boolean }) => Promise<unknown>;
  readonly done: string;
}

const ToastCtx = createContext<{ toast: (text: string, tone?: 'ok' | 'error') => void; confirm: (spec: ConfirmSpec) => void }>({ toast: () => undefined, confirm: () => undefined });

export function useActions() {
  return useContext(ToastCtx);
}

/** Toasts and the confirm box for the whole portal. */
export function ActionsProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; text: string; tone: 'ok' | 'error' }[]>([]);
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const toast = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast, confirm: setSpec }}>
      {children}
      {spec ? <ConfirmBox spec={spec} onClose={() => setSpec(null)} onDone={(ok, text) => toast(text, ok ? 'ok' : 'error')} /> : null}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

function ConfirmBox({ spec, onClose, onDone }: { readonly spec: ConfirmSpec; readonly onClose: () => void; readonly onDone: (ok: boolean, text: string) => void }) {
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(spec.check?.initial ?? false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = busy || (!!spec.reason?.required && reason.trim().length < 3) || (!!spec.typeToConfirm && typed.trim().toUpperCase() !== spec.typeToConfirm);

  const go = async () => {
    setBusy(true);
    try {
      await spec.run({ reason: reason.trim(), checked });
      onDone(true, spec.done);
      onClose();
    } catch (e) {
      onDone(false, e instanceof ApiError ? `Not done: ${e.message}` : 'Not done: something went wrong');
      setBusy(false);
    }
  };

  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="alertdialog" aria-modal="true">
        <h2>{spec.title}</h2>
        <div className="modal-body">{spec.body}</div>
        {spec.check ? (
          <label className="check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />{spec.check.label}</label>
        ) : null}
        {spec.reason ? (
          <label>{spec.reason.label}{spec.reason.required ? '' : ' (optional)'}<textarea value={reason} maxLength={200} rows={3} onChange={(e) => setReason(e.target.value)} /></label>
        ) : null}
        {spec.typeToConfirm ? (
          <label>Type <b>{spec.typeToConfirm}</b> to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
        ) : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Back</button>
          <button className={`btn ${spec.danger ? 'danger' : 'primary'}`} disabled={blocked} onClick={() => void go()}>{busy ? 'Working…' : spec.confirm}</button>
        </div>
      </div>
    </div>
  );
}

/** "Label: value" rows inside a drawer. */
export function Facts({ rows }: { readonly rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="facts">
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

/** Masks all but the last 4 digits until clicked (phones on a shared screen). */
export function Phone({ value }: { readonly value: string }) {
  const [shown, setShown] = useState(false);
  if (!value) return <span className="muted">–</span>;
  return shown ? <a href={`tel:+91${value}`} className="mono">+91 {value}</a> : <button className="link inline mono" onClick={() => setShown(true)} title="Show the number">+91 ••••••{value.slice(-4)}</button>;
}
