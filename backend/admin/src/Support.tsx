// Reports (problems technicians and customers raised), Queries (live conversations handed over by the app's assistant,
// and call-back requests), and Chats (customer–technician chats of bookings: read, delete to save storage).
import { useEffect, useRef, useState } from 'react';
import { ago, api, type ConversationRow, STATUS_LABEL, type Ticket, when } from './api.ts';
import { Drawer, Empty, PageHead, Phone, Pill, Segmented, StatusPill, TableSkeleton, useActions, useLoad } from './ui.tsx';

const KIND: Readonly<Record<string, string>> = {
  CUSTOMER_UNAVAILABLE: 'Customer not available',
  WRONG_ADDRESS: 'Wrong address',
  CANNOT_COMPLETE: 'Could not complete',
  PAYMENT_PROBLEM: 'Payment problem',
  START_CODE_LOCKED: 'Start code locked',
  OTHER: 'Other',
  CALLBACK: 'Call me back',
  UNSAFE: 'Unsafe',
};

const TOPIC: Readonly<Record<string, string>> = { BOOKING: 'A booking', PAYMENT: 'Payment / refund', TECHNICIAN: 'The technician', APP: 'The app', OTHER: 'Other' };

// ---------- Reports ----------

export function ReportsPage({ onOpenBooking, onOpenPerson }: { readonly onOpenBooking: (id: string) => void; readonly onOpenPerson: (id: string) => void }) {
  const [state, setState] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const list = useLoad(() => api.tickets('reports', state), [state], 20_000);
  return (
    <div className="page">
      <PageHead title="Reports" sub="Problems technicians and customers raised: wrong address, payment, a locked start code, and more." >
        <Segmented value={state} onChange={setState} options={[['OPEN', 'Open'], ['RESOLVED', 'Resolved (30 days)']]} />
      </PageHead>
      <TicketList list={list.data} onChanged={list.reload} onOpenBooking={onOpenBooking} onOpenPerson={onOpenPerson} empty="No open reports." />
    </div>
  );
}

function TicketList({ list, onChanged, onOpenBooking, onOpenPerson, empty }: { readonly list: Ticket[] | null; readonly onChanged: () => void; readonly onOpenBooking: (id: string) => void; readonly onOpenPerson: (id: string) => void; readonly empty: string }) {
  const { confirm, toast } = useActions();
  if (!list) return <TableSkeleton rows={4} />;
  if (list.length === 0) return <div className="card"><Empty title="All clear">{empty}</Empty></div>;
  return (
    <div className="ticket-grid">
      {list.map((t) => (
        <article key={t.id} className={`ticket-card pri-${t.priority.toLowerCase()}`}>
          <header>
            <Pill tone={t.priority === 'URGENT' ? 'stop' : t.priority === 'HIGH' ? 'wait' : 'plain'}>{KIND[t.kind] ?? t.kind}</Pill>
            <span className="muted small">{ago(t.createdAt)}</span>
          </header>
          <div className="ticket-who">
            <button className="link inline strong" onClick={() => onOpenPerson(t.person.id)}>{t.person.name || 'No name'}</button>
            <span className="muted small">{t.person.role === 'TECHNICIAN' ? 'Technician' : 'Customer'}</span>
            <Phone value={t.person.phone} />
          </div>
          {t.note ? <p className="ticket-note">“{t.note}”</p> : null}
          {t.booking ? (
            <div className="ticket-booking">
              <button className="link inline mono" onClick={() => onOpenBooking(t.booking!.id)}>{t.booking.code}</button>
              <span className="muted small">{STATUS_LABEL[t.booking.status]}</span>
              {t.booking.otherName ? <span className="muted small">· with {t.booking.otherName}</span> : null}
            </div>
          ) : null}
          {t.state === 'RESOLVED' ? <div className="sos-resolution"><b>Done:</b> {t.resolution} <span className="muted small">{t.resolvedAt ? when(t.resolvedAt) : ''}</span></div> : (
            <footer>
              {t.handledBy ? <Pill tone="live">{t.handledBy} is on it</Pill> : <button className="btn small" onClick={() => void api.takeTicket(t.id).then(onChanged)}>I'm on it</button>}
              {t.kind === 'START_CODE_LOCKED' && t.booking ? (
                <button className="btn small" onClick={() => confirm({
                  title: `Unlock the start code of ${t.booking!.code}?`,
                  body: 'Only after calling the customer and the technician to check they are together at the door. The technician can then type the code again.',
                  confirm: 'Unlock',
                  run: async () => { const r = await api.unlockStart(t.booking!.code); toast(`Unlocked ${r.code}`); onChanged(); },
                  done: 'Start code unlocked',
                })}>Unlock start code</button>
              ) : null}
              <button className="btn small primary" onClick={() => confirm({
                title: 'Resolve?',
                body: 'Write what was done: it stays in the record.',
                confirm: 'Resolve',
                reason: { label: 'What was done', required: true },
                run: async ({ reason }) => { await api.resolveTicket(t.id, reason); onChanged(); },
                done: 'Resolved',
              })}>Resolve</button>
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}

// ---------- Queries ----------

export function QueriesPage({ onOpenBooking, onOpenPerson }: { readonly onOpenBooking: (id: string) => void; readonly onOpenPerson: (id: string) => void }) {
  const [tab, setTab] = useState<'LIVE' | 'CLOSED' | 'CALLBACKS'>('LIVE');
  const [open, setOpen] = useState<string | null>(null);
  const convs = useLoad(() => (tab === 'CALLBACKS' ? Promise.resolve([] as ConversationRow[]) : api.conversations(tab === 'LIVE' ? 'OPEN' : 'CLOSED')), [tab], 6000);
  const callbacks = useLoad(() => (tab === 'CALLBACKS' ? api.tickets('queries', 'OPEN') : Promise.resolve([] as Ticket[])), [tab], 20_000);
  const { confirm } = useActions();

  return (
    <div className="page">
      <PageHead title="Queries" sub="Customers and technicians the app's assistant handed over to you, and call-back requests.">
        {tab === 'CLOSED' ? (
          <button className="btn" onClick={() => confirm({
            title: 'Delete old closed conversations?',
            body: 'Closed conversations older than the number of days you choose are deleted for good, to save storage.',
            confirm: 'Delete',
            danger: true,
            reason: { label: 'Older than how many days (e.g. 30)', required: true },
            run: async ({ reason }) => {
              const days = Math.max(1, Math.min(365, Number.parseInt(reason, 10) || 30));
              await api.cleanupConversations(days);
              convs.reload();
            },
            done: 'Old conversations deleted',
          })}>Clean up old ones</button>
        ) : null}
      </PageHead>
      <div className="toolbar">
        <Segmented value={tab} onChange={(v) => { setTab(v); setOpen(null); }} options={[['LIVE', 'Live chats'], ['CLOSED', 'Closed'], ['CALLBACKS', 'Call-back requests']]} />
      </div>
      {tab === 'CALLBACKS' ? <TicketList list={callbacks.data} onChanged={callbacks.reload} onOpenBooking={onOpenBooking} onOpenPerson={onOpenPerson} empty="Nobody is waiting for a call." /> : (
        <div className="inbox">
          <div className="inbox-list card flush">
            {!convs.data ? <TableSkeleton rows={5} /> : convs.data.length === 0 ? <Empty title={tab === 'LIVE' ? 'No live chats' : 'None closed'}>{tab === 'LIVE' ? 'When the app hands someone over, they appear here.' : null}</Empty> : convs.data.map((c) => (
              <button key={c.id} className={`inbox-row${open === c.id ? ' on' : ''}`} onClick={() => setOpen(c.id)}>
                <div className={`sos-avatar small ${c.role === 'TECHNICIAN' ? 'tech' : 'cust'}`}>{(c.name || '?').slice(0, 1)}</div>
                <div className="inbox-text">
                  <div className="inbox-top"><b>{c.name || 'No name'}</b><span className="muted small">{ago(c.lastMessageAt)}</span></div>
                  <div className="muted small">{TOPIC[c.topic] ?? c.topic} · {c.role === 'TECHNICIAN' ? 'technician' : 'customer'}</div>
                  <div className="inbox-preview">{c.preview}</div>
                </div>
                {c.unread > 0 ? <span className="badge">{c.unread}</span> : null}
              </button>
            ))}
          </div>
          <div className="inbox-pane card flush">
            {open ? <ConversationPane id={open} onChanged={() => { convs.reload(); }} onClosed={() => { setOpen(null); convs.reload(); }} onOpenPerson={onOpenPerson} /> : <Empty title="Pick a conversation">Replies reach the person in the app within seconds.</Empty>}
          </div>
        </div>
      )}
    </div>
  );
}

function ConversationPane({ id, onChanged, onClosed, onOpenPerson }: { readonly id: string; readonly onChanged: () => void; readonly onClosed: () => void; readonly onOpenPerson: (id: string) => void }) {
  const c = useLoad(() => api.conversation(id), [id], 5000);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { confirm, toast } = useActions();
  const end = useRef<HTMLDivElement>(null);
  const count = c.data?.messages.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await api.reply(id, t);
      setText('');
      c.reload();
      onChanged();
    } catch (e) {
      toast(`Not sent: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!c.data) return <TableSkeleton rows={6} />;
  const conv = c.data;
  return (
    <div className="conv">
      <header className="conv-head">
        <div>
          <b>{TOPIC[conv.topic] ?? conv.topic}</b>{conv.bookingCode ? <span className="mono muted"> · {conv.bookingCode}</span> : null}
          <div className="muted small">Started {when(conv.createdAt)} · <button className="link inline" onClick={() => onOpenPerson(conv.userId)}>open profile</button></div>
        </div>
        <div className="head-actions">
          {conv.state === 'OPEN' ? <button className="btn small" onClick={() => void api.closeConversation(id).then(() => { toast('Closed'); c.reload(); onChanged(); })}>Close</button> : <Pill tone="plain">Closed</Pill>}
          <button className="btn small danger-outline" onClick={() => confirm({
            title: 'Delete this conversation?',
            body: 'Every message is deleted for good.',
            confirm: 'Delete',
            danger: true,
            typeToConfirm: 'DELETE',
            run: async () => { await api.deleteConversation(id); onClosed(); },
            done: 'Conversation deleted',
          })}>Delete</button>
        </div>
      </header>
      <div className="conv-body">
        {conv.messages.map((m) => m.from === 'SYSTEM' ? (
          <div key={m.id} className="conv-note">{m.text}</div>
        ) : (
          <div key={m.id} className={`conv-msg ${m.from === 'HQ' ? 'mine' : ''}`}>
            <div className="conv-bubble">{m.text}</div>
            <span className="muted small">{m.from === 'HQ' ? 'Housefi team' : 'Them'} · {when(m.at)}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      {conv.state === 'OPEN' ? (
        <div className="conv-input">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply… (Enter to send, Shift+Enter for a new line)" rows={2} maxLength={1000}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button className="btn primary" disabled={!text.trim() || busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      ) : null}
    </div>
  );
}

// ---------- Chats ----------

export function ChatsPage({ onOpenBooking }: { readonly onOpenBooking: (id: string) => void }) {
  const list = useLoad(() => api.chats(), [], 30_000);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="page">
      <PageHead title="Chats" sub="Customer–technician chats of bookings. They clear themselves a day after the job; delete one sooner to save storage. Reading one is recorded in the audit log." />
      <div className="card flush">
        {!list.data ? <TableSkeleton /> : list.data.length === 0 ? <Empty title="No chats stored" /> : (
          <table className="table">
            <thead><tr><th>Booking</th><th>Status</th><th>Customer</th><th>Technician</th><th>Messages</th><th>Last message</th></tr></thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.bookingId} onClick={() => setOpen(c.bookingId)}>
                  <td className="mono strong">{c.code}</td>
                  <td><StatusPill status={c.status} /></td>
                  <td>{c.customer || '–'}</td>
                  <td>{c.technician || '–'}</td>
                  <td>{c.messages}</td>
                  <td className="muted">{ago(c.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open ? <ChatPanel bookingId={open} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); list.reload(); }} onOpenBooking={onOpenBooking} /> : null}
    </div>
  );
}

function ChatPanel({ bookingId, onClose, onDeleted, onOpenBooking }: { readonly bookingId: string; readonly onClose: () => void; readonly onDeleted: () => void; readonly onOpenBooking: (id: string) => void }) {
  const chat = useLoad(() => api.chat(bookingId), [bookingId]);
  const { confirm } = useActions();
  return (
    <Drawer title={chat.data ? <span className="mono">{chat.data.code}</span> : 'Chat'} sub="Customer on the left, technician on the right" onClose={onClose}>
      <div className="actions-row">
        <button className="btn" onClick={() => onOpenBooking(bookingId)}>Open booking</button>
        <button className="btn danger-outline" onClick={() => confirm({
          title: 'Delete this chat?',
          body: 'Every message and photo of this chat is deleted for good, for both sides.',
          confirm: 'Delete chat',
          danger: true,
          typeToConfirm: 'DELETE',
          run: async () => { await api.deleteChat(bookingId); onDeleted(); },
          done: 'Chat deleted',
        })}>Delete chat</button>
      </div>
      {!chat.data ? <TableSkeleton rows={6} /> : (
        <div className="conv-body plain">
          {chat.data.messages.map((m) => (
            <div key={m.id} className={`conv-msg ${m.from === 'TECHNICIAN' ? 'mine' : ''}`}>
              <div className="conv-bubble">{m.text}{m.photo ? <a href={m.photo} target="_blank" rel="noreferrer noopener"><img src={m.photo} alt="Chat photo" className="conv-photo" /></a> : null}</div>
              <span className="muted small">{m.from === 'TECHNICIAN' ? 'Technician' : 'Customer'} · {when(m.at)}</span>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
