// Sarathi, the HQ guide: a floating orb on every page that opens a chat. It answers from live data, summarises, reads
// photos and listens (voice to text), and prepares actions as cards. Nothing happens until you approve a card: a click
// for small things, typing the confirmation for bigger ones, typing it twice plus Windows Hello for deletions. The
// server checks every step again; the card only collects them.
import { startAuthentication } from '@simplewebauthn/browser';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type Proposal } from './api.ts';
import { useActions } from './ui.tsx';

export type GuideLink = { kind: 'booking'; code: string } | { kind: 'person'; id: string } | { kind: 'page'; page: string };

interface Turn {
  readonly id: string;
  readonly role: 'admin' | 'guide';
  readonly text: string;
  readonly photo?: string | null;
  readonly used?: readonly string[];
  readonly proposals?: readonly string[];
}

const SUGGESTIONS = ['What needs my attention right now?', 'Summarise today in 5 lines', 'Any open SOS?', 'Revenue trend this month', 'Which technicians are online?', 'Unread support chats'];
const TOOL_LABEL: Readonly<Record<string, string>> = {
  overview: 'today', list_bookings: 'bookings', get_booking: 'a booking', find_people: 'people', get_person: 'a profile', list_tickets: 'tickets',
  list_conversations: 'conversations', read_conversation: 'a conversation', list_booking_chats: 'chats', read_booking_chat: 'a chat', analytics: 'analytics',
  payouts: 'payouts', audit_log: 'audit log', services: 'services & prices', coupons: 'coupons', announcements: 'announcements',
};

// ---------- text with light formatting and portal links ----------

/** **bold**, `code`, "- " bullets, line breaks, and [[booking:HF-1]] / [[person:id|Name]] / [[page:sos]] links. No HTML. */
export function GuideText({ text, onLink }: { readonly text: string; readonly onLink: (l: GuideLink) => void }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`u${blocks.length}`}>{list}</ul>);
    list = [];
  };
  lines.forEach((line, i) => {
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      list.push(<li key={i}>{inline((bullet ?? numbered)![1]!, onLink)}</li>);
      return;
    }
    flush();
    if (line.trim() === '') return;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(heading ? <h4 key={i}>{inline(heading[1]!, onLink)}</h4> : <p key={i}>{inline(line, onLink)}</p>);
  });
  flush();
  return <div className="guide-text">{blocks}</div>;
}

function inline(s: string, onLink: (l: GuideLink) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[\[(booking|person|page):([^\]|]+)(?:\|([^\]]+))?\]\]|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(<Fragment key={k++}>{s.slice(last, m.index)}</Fragment>);
    if (m[1]) {
      const kind = m[1];
      const value = m[2]!.trim();
      const label = m[3]?.trim() ?? (kind === 'page' ? value : value);
      const link: GuideLink = kind === 'booking' ? { kind, code: value } : kind === 'person' ? { kind, id: value } : { kind: 'page', page: value };
      out.push(<button key={k++} className={`guide-chip ${kind}`} onClick={() => onLink(link)}>{kind === 'page' ? `Open ${label}` : label}</button>);
    } else if (m[4]) out.push(<b key={k++}>{m[4]}</b>);
    else if (m[5]) out.push(<code key={k++}>{m[5]}</code>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(<Fragment key={k++}>{s.slice(last)}</Fragment>);
  return out;
}

// ---------- photo and voice ----------

/** A photo as a JPEG data URL at most 1280 px on its long side (sent once, never stored). */
async function shrink(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('not an image'));
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    let q = 0.85;
    let data = c.toDataURL('image/jpeg', q);
    while (data.length > 1_700_000 && q > 0.4) data = c.toDataURL('image/jpeg', (q -= 0.15));
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---------- the floating guide ----------

export function Guide({ me, onLink }: { readonly me: string; readonly onLink: (l: GuideLink) => void }) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [mode, setMode] = useState<'full' | 'basic'>('full');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState<'en-IN' | 'te-IN' | 'hi-IN'>('en-IN');
  const [loaded, setLoaded] = useState(false);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const { toast, confirm } = useActions();
  const Speech = speechCtor();
  const pending = Object.values(proposals).filter((p) => p.state === 'PROPOSED' && p.expiresAt > Date.now()).length;

  // The conversation (kept 7 days on the server) loads when the panel first opens.
  useEffect(() => {
    if (!open || loaded) return;
    api.guide().then((g) => {
      setTurns(g.messages.map((m, i) => ({ id: `h${i}`, role: m.role, text: m.text })));
      setProposals(Object.fromEntries(g.pending.map((p) => [p.id, p])));
      setMode(g.mode);
      setLoaded(true);
      if (g.pending.length) setTurns((t) => [...t, { id: 'pending', role: 'guide', text: 'These are still waiting for your decision:', proposals: g.pending.map((p) => p.id) }]);
    }, () => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns, thinking, open]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
  }, [open]);

  // Ctrl + / opens the guide from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ask = async (raw: string) => {
    const message = raw.trim();
    if ((!message && !photo) || thinking) return;
    const sentPhoto = photo;
    setTurns((t) => [...t, { id: `a${Date.now()}`, role: 'admin', text: message, photo: sentPhoto }]);
    setText('');
    setPhoto(null);
    setThinking(true);
    try {
      const r = await api.ask(message, sentPhoto);
      setMode(r.mode);
      setProposals((p) => ({ ...p, ...Object.fromEntries(r.proposals.map((x) => [x.id, x])) }));
      setTurns((t) => [...t, { id: `g${Date.now()}`, role: 'guide', text: r.reply, used: r.used, proposals: r.proposals.map((x) => x.id) }]);
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 429 ? `Too many questions at once: try again in ${e.retryAfterSec ?? 60} s.` : e instanceof ApiError ? e.message : 'I could not answer just now.';
      setTurns((t) => [...t, { id: `e${Date.now()}`, role: 'guide', text: `⚠️ ${msg}` }]);
    } finally {
      setThinking(false);
    }
  };

  const attach = async (file: File | Blob | null | undefined) => {
    if (!file || !/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.type)) {
      if (file) toast('Only photos can be attached', 'error');
      return;
    }
    try {
      setPhoto(await shrink(file));
    } catch {
      toast('That photo could not be read', 'error');
    }
  };

  const listen = () => {
    if (!Speech) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Speech();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    const before = text ? `${text.trim()} ` : '';
    r.onresult = (e) => {
      let said = '';
      for (let i = 0; i < e.results.length; i++) said += e.results[i]![0]!.transcript;
      setText(before + said);
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      if (e.error === 'not-allowed') toast('Allow the microphone for this page to talk to Sarathi', 'error');
    };
    rec.current = r;
    setListening(true);
    r.start();
  };

  const clear = () => confirm({
    title: 'Clear the conversation?',
    body: 'Sarathi forgets this conversation, and any proposal still waiting is cancelled.',
    confirm: 'Clear',
    run: async () => {
      await api.clearGuide();
      setTurns([]);
      setProposals({});
    },
    done: 'Conversation cleared',
  });

  const updated = useCallback((p: Proposal) => setProposals((all) => ({ ...all, [p.id]: p })), []);

  return (
    <>
      <button className={`guide-orb${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close Sarathi' : 'Ask Sarathi, your HQ guide (Ctrl + /)'} title="Sarathi, your HQ guide (Ctrl + /)">
        <span className="orb-ring" />
        <span className="orb-core"><CompassGlyph /></span>
        {pending > 0 && !open ? <span className="orb-badge">{pending}</span> : null}
      </button>
      {open ? (
        <section className={`guide-panel${wide ? ' wide' : ''}`} role="dialog" aria-label="Sarathi, your HQ guide"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void attach(e.dataTransfer.files[0]); }}>
          <header className="guide-head">
            <div className="guide-id">
              <span className="guide-avatar"><CompassGlyph /></span>
              <div>
                <b>Sarathi</b>
                <span>{mode === 'full' ? 'Your HQ guide · sees the whole portal, acts only with your approval' : 'Basic mode · no AI model on the server'}</span>
              </div>
            </div>
            <div className="guide-tools">
              <button className="g-icon" onClick={clear} title="Clear conversation" aria-label="Clear conversation">⟲</button>
              <button className="g-icon" onClick={() => setWide((w) => !w)} title={wide ? 'Smaller' : 'Bigger'} aria-label="Resize">{wide ? '⤡' : '⤢'}</button>
              <button className="g-icon" onClick={() => setOpen(false)} title="Close (Esc)" aria-label="Close">×</button>
            </div>
          </header>

          <div className="guide-body" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
            {turns.length === 0 && loaded ? (
              <div className="guide-hello">
                <div className="guide-hello-orb"><CompassGlyph /></div>
                <h3>Namaste, {me.split(' ')[0]} 👋</h3>
                <p>I'm Sarathi. Ask me anything about Housefi: bookings, people, SOS, money, trends. I can prepare actions too, but <b>nothing happens until you approve it</b>.</p>
                <div className="guide-suggest">{SUGGESTIONS.map((s) => <button key={s} onClick={() => void ask(s)}>{s}</button>)}</div>
              </div>
            ) : null}
            {turns.map((t) => (
              <div key={t.id} className={`g-turn ${t.role}`}>
                {t.role === 'guide' ? <span className="g-mini"><CompassGlyph /></span> : null}
                <div className="g-bubble">
                  {t.photo ? <img src={t.photo} alt="Attached" className="g-photo" /> : null}
                  {t.role === 'guide' ? <GuideText text={t.text} onLink={onLink} /> : t.text ? <p>{t.text}</p> : null}
                  {t.proposals?.map((id) => (proposals[id] ? <ProposalCard key={id} p={proposals[id]!} onUpdated={updated} /> : null))}
                  {t.used && t.used.some((u) => TOOL_LABEL[u]) ? <div className="g-used">Looked at: {[...new Set(t.used.filter((u) => TOOL_LABEL[u]).map((u) => TOOL_LABEL[u]))].join(', ')}</div> : null}
                </div>
              </div>
            ))}
            {thinking ? (
              <div className="g-turn guide">
                <span className="g-mini spinning"><CompassGlyph /></span>
                <div className="g-bubble g-thinking"><span /><span /><span /><em>Looking it up…</em></div>
              </div>
            ) : null}
            <div ref={end} />
          </div>

          <footer className="guide-compose">
            {photo ? (
              <div className="g-attach"><img src={photo} alt="To send" /><button onClick={() => setPhoto(null)} aria-label="Remove photo">×</button></div>
            ) : null}
            <div className="g-row">
              <textarea ref={input} value={text} rows={1} maxLength={4000} placeholder={listening ? 'Listening…' : 'Ask Sarathi… (Enter to send)'}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  const f = Array.from(e.clipboardData.files).find((x) => x.type.startsWith('image/'));
                  if (f) {
                    e.preventDefault();
                    void attach(f);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void ask(text);
                  }
                  if (e.key === 'Escape') setOpen(false);
                }} />
              <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ''; }} />
              <button className="g-icon" onClick={() => fileInput.current?.click()} title="Attach a photo (or paste / drop one)" aria-label="Attach a photo">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9" /><circle cx="9" cy="10" r="2" /><path d="m21 15-3.5-3.5L9 20M19 17v6M16 20h6" /></svg>
              </button>
              {Speech ? (
                <>
                  <select className="g-lang" value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} title="Language you speak" aria-label="Speaking language">
                    <option value="en-IN">EN</option>
                    <option value="te-IN">తె</option>
                    <option value="hi-IN">हि</option>
                  </select>
                  <button className={`g-icon${listening ? ' rec' : ''}`} onClick={listen} title={listening ? 'Stop' : 'Speak'} aria-label={listening ? 'Stop listening' : 'Speak'}>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5" /></svg>
                  </button>
                </>
              ) : null}
              <button className="g-send" disabled={(!text.trim() && !photo) || thinking} onClick={() => void ask(text)} aria-label="Send">➤</button>
            </div>
            <div className="g-foot">Sarathi can make mistakes: check before approving. Ctrl + / opens it anywhere.</div>
          </footer>
        </section>
      ) : null}
    </>
  );
}

/** An action waiting for approval, with the checks its risk needs. */
function ProposalCard({ p, onUpdated }: { readonly p: Proposal; readonly onUpdated: (p: Proposal) => void }) {
  const [typed, setTyped] = useState('');
  const [typedAgain, setTypedAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (p.state !== 'PROPOSED') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [p.state]);
  const left = Math.max(0, p.expiresAt - now);
  const expired = p.state === 'PROPOSED' && left === 0;
  const same = (a: string) => !!p.phrase && a.trim().replace(/\s+/g, ' ').toUpperCase() === p.phrase.toUpperCase();
  const ready = p.risk === 'LOW' || (p.risk === 'HIGH' && same(typed)) || (p.risk === 'CRITICAL' && same(typed) && same(typedAgain));

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      let passkey: unknown;
      if (p.risk === 'CRITICAL') {
        const { options } = await api.stepUp(p.id);
        passkey = await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]['optionsJSON'] });
      }
      onUpdated(await api.approve(p.id, { typed, typedAgain, passkey }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error && e.name === 'NotAllowedError' ? 'Windows Hello was cancelled' : 'Not done');
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    setBusy(true);
    try {
      onUpdated(await api.reject(p.id));
    } finally {
      setBusy(false);
    }
  };

  const riskLabel = p.risk === 'LOW' ? 'Needs your OK' : p.risk === 'HIGH' ? 'Needs your OK + typed confirmation' : 'Deletion · typed twice + Windows Hello';
  return (
    <div className={`proposal risk-${p.risk.toLowerCase()} state-${p.state.toLowerCase()}`}>
      <div className="proposal-head">
        <span className="proposal-risk">{p.risk === 'CRITICAL' ? '⛔' : p.risk === 'HIGH' ? '⚠️' : '✅'} {riskLabel}</span>
        {p.state === 'PROPOSED' && !expired ? <span className="proposal-timer">expires in {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}</span> : null}
      </div>
      <p className="proposal-summary">{p.summary}</p>
      {p.state === 'PROPOSED' && !expired ? (
        <>
          {p.risk !== 'LOW' ? (
            <label className="proposal-type">Type <code>{p.phrase}</code> to confirm
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={same(typed) ? 'ok' : ''} />
            </label>
          ) : null}
          {p.risk === 'CRITICAL' ? (
            <label className="proposal-type">Type it again (second approval)
              <input value={typedAgain} onChange={(e) => setTypedAgain(e.target.value)} autoComplete="off" spellCheck={false} className={same(typedAgain) ? 'ok' : ''} onPaste={(e) => e.preventDefault()} />
            </label>
          ) : null}
          {error ? <div className="proposal-error">{error}</div> : null}
          <div className="proposal-actions">
            <button className="btn small" disabled={busy} onClick={() => void reject()}>Don't do it</button>
            <button className={`btn small ${p.risk === 'CRITICAL' ? 'danger' : 'primary'}`} disabled={!ready || busy} onClick={() => void approve()}>
              {busy ? 'Working…' : p.risk === 'CRITICAL' ? 'Approve with Windows Hello' : 'Approve'}
            </button>
          </div>
        </>
      ) : (
        <div className="proposal-result">
          {expired || p.state === 'EXPIRED' ? '⌛ Expired: ask again if you still want it.' : p.state === 'DONE' ? `✔ Done. ${p.result ?? ''}` : p.state === 'FAILED' ? `✖ Not done: ${p.result ?? ''}` : '✋ You said no. Nothing was changed.'}
        </div>
      )}
    </div>
  );
}

/** Sarathi's mark: a compass star (a guide, not a robot). */
function CompassGlyph() {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
      <path d="M16 2 L19 13 L30 16 L19 19 L16 30 L13 19 L2 16 L13 13 Z" fill="currentColor" />
      <circle cx="16" cy="16" r="3" fill="#0b1430" />
    </svg>
  );
}
