// Skill checks: technicians waiting for a person (a work video to watch, a certificate to check, or a skill check sent
// with no trade verified yet), and one technician in the side panel: their level, each trade (verify or withdraw it
// by hand, e.g. a keypad-phone technician tested in person), their exams question by question (what they chose, what
// was right, how long it took, how often they changed it, how often they left the app), the video to watch and approve
// for the trades it shows, and the certificates. The profile itself is approved on the Technicians page (or by itself
// once everything is ready).
import { useState } from 'react';
import { api, ago, type CategoryId, type SkillDetail, TRADE_LABEL, when } from './api.ts';
import { Drawer, Empty, Facts, PageHead, Pill, Segmented, TableSkeleton, useActions, useLoad } from './ui.tsx';

const LEVEL: Readonly<Record<string, string>> = { UNSKILLED: 'New (unskilled)', SEMI_SKILLED: 'Semi-skilled', SKILLED: 'Skilled', HIGHLY_SKILLED: 'Highly skilled' };
const VIA: Readonly<Record<string, string>> = { EXAM: 'exam passed', VIDEO: 'video approved', HQ: 'verified by HQ', EARLIER: 'before the skill check' };
const SECTION = ['Questions', 'Pictures', 'Choose the part'];

export function SkillsPage({ onOpenPerson }: { readonly onOpenPerson: (id: string) => void }) {
  const [state, setState] = useState<'WAITING' | 'ALL'>('WAITING');
  const [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => api.skillQueue(state), [state], 30_000);
  return (
    <div className="page">
      <PageHead title="Skill checks" sub="Watch work videos, check certificates, and see each technician's exam. Jobs go only to verified trades." />
      <div className="toolbar">
        <Segmented value={state} onChange={setState} options={[['WAITING', 'Waiting for HQ'], ['ALL', 'All']]} />
      </div>
      <div className="card flush">
        {!list.data ? <TableSkeleton rows={5} /> : list.data.length === 0 ? <Empty title={state === 'WAITING' ? 'Nothing waiting' : 'No skill checks yet'}>{state === 'WAITING' ? 'New videos and certificates show here.' : null}</Empty> : (
          <table className="table">
            <thead><tr><th>Technician</th><th>Level</th><th>Trades</th><th>Exams</th><th>Waiting</th><th>Sent</th></tr></thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.technicianId} onClick={() => setOpen(r.technicianId)} className={open === r.technicianId ? 'selected' : ''}>
                  <td className="strong">{r.name || <span className="muted">No name</span>}{r.demo ? <Pill tone="plain">demo</Pill> : null}<div className="muted small mono">{r.techCode ?? ''}</div></td>
                  <td>{r.level ? LEVEL[r.level] : <span className="muted">–</span>}</td>
                  <td>{r.trades.map((t) => <span key={t.categoryId} className="trade-chip">{TRADE_LABEL[t.categoryId] ?? t.categoryId} {t.verifiedVia ? '✓' : '·'}</span>)}</td>
                  <td>{r.exams.length ? r.exams.map((e) => <Pill key={e.categoryId} tone={e.passed ? 'done' : 'stop'}>{TRADE_LABEL[e.categoryId]} {e.points}/24</Pill>) : <span className="muted">none</span>}</td>
                  <td>{r.videoWaiting ? <Pill tone="wait">video</Pill> : null} {r.certificatesWaiting ? <Pill tone="wait">{r.certificatesWaiting} certificate{r.certificatesWaiting > 1 ? 's' : ''}</Pill> : null}</td>
                  <td className="muted">{r.submittedAt ? ago(r.submittedAt) : 'not sent'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open ? <SkillPanel id={open} onClose={() => setOpen(null)} onChanged={list.reload} onOpenPerson={onOpenPerson} /> : null}
    </div>
  );
}

function SkillPanel({ id, onClose, onChanged, onOpenPerson }: { readonly id: string; readonly onClose: () => void; readonly onChanged: () => void; readonly onOpenPerson: (id: string) => void }) {
  const d = useLoad(() => api.skillDetail(id), [id]);
  const { confirm } = useActions();
  const s = d.data;
  const [ticked, setTicked] = useState<readonly CategoryId[]>([]);
  const changed = async (fn: () => Promise<unknown>) => {
    await fn();
    d.reload();
    onChanged();
  };

  return (
    <Drawer title={s ? s.name || 'No name' : 'Loading…'} sub={s ? <>{s.techCode ?? 'No ID yet'} · {s.level ? LEVEL[s.level] : 'level not chosen'}{s.demo ? ' · demo account' : ''}</> : null} onClose={onClose} wide>
      {!s ? (d.error ? <div className="alert">{d.error}</div> : <TableSkeleton rows={6} />) : (
        <>
          <div className="actions-row">
            <button className="btn" onClick={() => onOpenPerson(s.technicianId)}>Open profile (approve, suspend…)</button>
          </div>
          <Facts rows={[
            ['Profile', s.verification.toLowerCase().replace('_', ' ')],
            ['Skill check sent', s.submittedAt ? when(s.submittedAt) : 'Not yet'],
          ]} />

          <section>
            <h3>Trades</h3>
            <table className="table compact">
              <tbody>
                {s.trades.map((t) => (
                  <tr key={t.categoryId} className="static">
                    <td className="strong">{TRADE_LABEL[t.categoryId] ?? t.categoryId}</td>
                    <td>{t.verifiedVia ? <Pill tone="done">verified · {VIA[t.verifiedVia] ?? t.verifiedVia}</Pill> : <Pill tone="wait">not verified: no jobs</Pill>}</td>
                    <td className="right">
                      {t.verifiedVia
                        ? <button className="btn small danger-outline" onClick={() => confirm({ title: `Withdraw ${TRADE_LABEL[t.categoryId]}?`, body: 'No more job offers for this trade until it is verified again.', confirm: 'Withdraw', danger: true, reason: { label: 'Why (kept in the audit log)', required: true }, run: ({ reason }) => changed(() => api.decideTrade(id, t.categoryId, false, reason)), done: 'Trade withdrawn' })}>Withdraw</button>
                        : <button className="btn small" onClick={() => confirm({ title: `Verify ${TRADE_LABEL[t.categoryId]} by hand?`, body: 'Only after you checked their work yourself (e.g. tested in person, a keypad-phone technician).', confirm: 'Verify trade', reason: { label: 'How you checked (kept in the audit log)', required: true }, run: ({ reason }) => changed(() => api.decideTrade(id, t.categoryId, true, reason)), done: 'Trade verified' })}>Verify by hand</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3>Work video</h3>
            {s.videos.length === 0 ? <p className="muted">No video.</p> : s.videos.map((v) => (
              <div key={v.id} className="card inner">
                <div className="row-between">
                  <span><Pill tone={v.status === 'APPROVED' ? 'done' : v.status === 'REJECTED' ? 'stop' : 'wait'}>{v.status.toLowerCase()}</Pill> <span className="muted small">{v.source === 'LIVE' ? 'recorded in the app' : v.source === 'UPLOAD' ? 'from the gallery' : 'demo sample (no real video)'}{v.durationSec ? ` · ${v.durationSec} s` : ''} · {ago(v.createdAt)}</span></span>
                </div>
                {v.url ? <video className="skill-video" src={v.url} controls preload="metadata" /> : <p className="muted">Demo sample: there is no real video to watch.</p>}
                {v.status === 'PENDING' ? (
                  <>
                    <p className="small">Which trades does it show? Check that the face matches the profile photo.</p>
                    <div className="checks">
                      {s.trades.map((t) => (
                        <label key={t.categoryId} className="check">
                          <input type="checkbox" checked={ticked.includes(t.categoryId)} onChange={(e) => setTicked(e.target.checked ? [...ticked, t.categoryId] : ticked.filter((x) => x !== t.categoryId))} />
                          {TRADE_LABEL[t.categoryId] ?? t.categoryId}
                        </label>
                      ))}
                    </div>
                    <div className="actions-row">
                      <button className="btn primary" disabled={ticked.length === 0} onClick={() => confirm({ title: 'Approve this video?', body: `Verifies: ${ticked.map((c) => TRADE_LABEL[c]).join(', ')}. Job offers can come for these trades.`, confirm: 'Approve video', reason: { label: 'Note (optional)' }, run: ({ reason }) => changed(() => api.decideVideo(v.id, 'APPROVE', ticked, reason)), done: 'Video approved' })}>Approve for ticked trades</button>
                      <button className="btn danger-outline" onClick={() => confirm({ title: 'Refuse this video?', body: 'The technician sees your note and can record again.', confirm: 'Refuse video', danger: true, reason: { label: 'Note for the technician', required: true }, run: ({ reason }) => changed(() => api.decideVideo(v.id, 'REJECT', [], reason)), done: 'Video refused' })}>Refuse</button>
                    </div>
                  </>
                ) : v.reviewNote ? <p className="muted small">Note: {v.reviewNote}</p> : null}
              </div>
            ))}
          </section>

          <section>
            <h3>Certificates</h3>
            {s.certificates.length === 0 ? <p className="muted">None.</p> : s.certificates.map((c) => (
              <div key={c.id} className="card inner">
                <div className="row-between">
                  <span className="strong">{c.kind === 'SKILL_INDIA' ? 'Skill India' : c.kind === 'ITI' ? 'ITI' : 'Other'}{c.title ? ` · ${c.title}` : ''}</span>
                  <Pill tone={c.status === 'APPROVED' ? 'done' : c.status === 'REJECTED' ? 'stop' : 'wait'}>{c.status.toLowerCase()}</Pill>
                </div>
                {c.url ? (c.contentType === 'application/pdf' ? <a className="link" href={c.url} target="_blank" rel="noreferrer noopener">Open the PDF</a> : <img className="skill-cert" src={c.url} alt="Certificate" />) : <p className="muted">Demo sample: no real file.</p>}
                {c.status === 'PENDING' ? (
                  <div className="actions-row">
                    <button className="btn primary" onClick={() => confirm({ title: 'Approve this certificate?', body: 'It shows as a certification on the technician\'s profile and ID page.', confirm: 'Approve', run: () => changed(() => api.decideCertificate(c.id, 'APPROVE', '')), done: 'Certificate approved' })}>Approve</button>
                    <button className="btn danger-outline" onClick={() => confirm({ title: 'Refuse this certificate?', body: 'The technician sees your note.', confirm: 'Refuse', danger: true, reason: { label: 'Note for the technician', required: true }, run: ({ reason }) => changed(() => api.decideCertificate(c.id, 'REJECT', reason)), done: 'Certificate refused' })}>Refuse</button>
                  </div>
                ) : c.reviewNote ? <p className="muted small">Note: {c.reviewNote}</p> : null}
              </div>
            ))}
          </section>

          <section>
            <h3>Exams</h3>
            {s.attempts.length === 0 ? <p className="muted">No exam taken.</p> : s.attempts.map((a) => <Attempt key={a.id} a={a} />)}
          </section>
        </>
      )}
    </Drawer>
  );
}

function Attempt({ a }: { readonly a: SkillDetail['attempts'][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card inner">
      <div className="row-between">
        <span className="strong">{TRADE_LABEL[a.categoryId] ?? a.categoryId} · {LEVEL[a.level] ?? a.level}</span>
        <span>
          {a.submittedAt === null ? <Pill tone="live">in progress</Pill> : <Pill tone={a.passed ? 'done' : 'stop'}>{a.passed ? 'passed' : 'not passed'} · {a.points}/{a.maxPoints}</Pill>}
          {a.autoSubmitted ? <Pill tone="plain">submitted by itself</Pill> : null}
          {a.leftApp ? <Pill tone="wait">left the app {a.leftApp}×</Pill> : null}
        </span>
      </div>
      <p className="muted small">Started {when(a.startedAt)}{a.submittedAt ? ` · took ${Math.round((a.submittedAt - a.startedAt) / 60_000)} min` : ''}</p>
      <button className="btn small" onClick={() => setOpen(!open)}>{open ? 'Hide answers' : 'Show answers'}</button>
      {open ? (
        <table className="table compact">
          <thead><tr><th>#</th><th>Part</th><th>Question</th><th>Chose</th><th>Right answer</th><th>Time</th><th>Changes</th><th>Points</th></tr></thead>
          <tbody>
            {a.questions.map((q, i) => (
              <tr key={q.id} className="static">
                <td>{i + 1}</td>
                <td className="muted small">{SECTION[q.section]}</td>
                <td>{q.text}{q.art ? <div className="muted small mono">{q.art}</div> : null}</td>
                <td className={q.correct ? 'ok' : 'bad'}>{q.chosen ?? <span className="muted">not answered</span>}</td>
                <td>{q.right}</td>
                <td>{q.secondsTaken !== null ? `${q.secondsTaken} s` : '–'}{q.fast ? ' ⚡' : ''}</td>
                <td>{q.changes || ''}</td>
                <td className="strong">{q.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
