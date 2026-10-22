// Weekly payouts (every Monday): prepare one payout per technician for the week to Sunday, download the bank files
// (one bulk upload for bank transfers, one for UPI: the payout kit, built with IBM Bob), pay, then mark each paid with
// the transfer reference (or failed: it goes into next Monday's run).
import { useState } from 'react';
import { api, rupees, type BankFiles } from './api.ts';
import { Empty, PageHead, Pill, Segmented, TableSkeleton, useActions, useLoad } from './ui.tsx';

export function Payouts() {
  const [state, setState] = useState<'PENDING' | 'PAID' | 'FAILED'>('PENDING');
  const list = useLoad(() => api.payouts(state), [state]);
  const { confirm, toast } = useActions();
  const total = (list.data ?? []).reduce((s, p) => s + p.amount, 0);
  const [files, setFiles] = useState<BankFiles | null>(null);
  const [making, setMaking] = useState(false);

  const save = (filename: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const bankFiles = async () => {
    setMaking(true);
    try {
      const made = await api.bankFiles();
      setFiles(made);
      made.files.forEach((f) => save(f.filename, f.content, 'text/csv;charset=utf-8'));
      toast(made.files.length ? `${made.files.length} bank file${made.files.length === 1 ? '' : 's'} downloaded` : 'No payout could go in a bank file: see below', made.files.length ? 'ok' : 'error');
    } catch (e) {
      toast(`Not done: ${(e as Error).message}`, 'error');
    } finally {
      setMaking(false);
    }
  };

  const prepare = async () => {
    try {
      const made = await api.preparePayouts();
      toast(made.length ? `${made.length} payout${made.length === 1 ? '' : 's'} ready to pay` : 'Nothing to pay this week');
      setState('PENDING');
      list.reload();
    } catch (e) {
      toast(`Not done: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <div className="page">
      <PageHead title="Payouts" sub="Every Monday: prepare, pay each technician by bank or UPI, then mark it paid with the reference.">
        <button className="btn primary" onClick={() => void prepare()}>Prepare this week's payouts</button>
        {state === 'PENDING' && list.data?.length ? <button className="btn" disabled={making} onClick={() => void bankFiles()}>{making ? 'Making files…' : 'Download bank files'}</button> : null}
      </PageHead>
      {files ? (
        <div className="card bank-files">
          <div className="bank-files-head">
            <h3>Bank files{files.weekEnding ? ` · week to ${files.weekEnding}` : ''}</h3>
            <button className="btn small" onClick={() => setFiles(null)}>Close</button>
          </div>
          {files.files.map((f) => (
            <div key={f.filename} className="bank-file">
              <span className="mono">{f.filename}</span>
              <span className="muted">{f.rail === 'BANK' ? 'Bank transfer (NEFT)' : 'UPI'} · {f.count} · {rupees(f.amount)}</span>
              <button className="btn small" onClick={() => save(f.filename, f.content, 'text/csv;charset=utf-8')}>Download again</button>
            </div>
          ))}
          {files.warnings.length ? <div className="notice warn"><b>Check before paying</b><ul>{files.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div> : null}
          {files.skipped.length ? <div className="notice stop"><b>Left out: fix these, then download again</b><ul>{files.skipped.map((x) => <li key={x.payoutId}><b>{x.technicianName}</b>: {x.problems.join('; ')}</li>)}</ul></div> : null}
          <p className="muted small">Upload each file in your bank's bulk-transfer page, then mark each payout paid with its reference. Check the column layout against your bank's template before the first real payment. <span className="credit">Payout kit · built with IBM Bob</span></p>
          <button className="btn small" onClick={() => save(`housefi-payouts-${files.weekEnding ?? 'summary'}-summary.txt`, files.summary, 'text/plain;charset=utf-8')}>Download summary</button>
        </div>
      ) : null}
      <div className="toolbar">
        <Segmented value={state} onChange={setState} options={[['PENDING', 'To pay'], ['PAID', 'Paid'], ['FAILED', 'Failed']]} />
        {list.data?.length ? <span className="muted">{list.data.length} · {rupees(total)} in all</span> : null}
      </div>
      <div className="card flush">
        {!list.data ? <TableSkeleton rows={4} /> : list.data.length === 0 ? <Empty title={state === 'PENDING' ? 'Nothing to pay' : 'None'}>{state === 'PENDING' ? 'Prepare this week’s payouts on Monday.' : null}</Empty> : (
          <table className="table">
            <thead><tr><th>Technician</th><th>Week</th><th>Amount</th><th>State</th><th>Reference</th><th /></tr></thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} className="static">
                  <td className="strong">{p.technicianName}</td>
                  <td>{p.periodStart} → {p.periodEnd}</td>
                  <td className="strong">{rupees(p.amount)}</td>
                  <td><Pill tone={p.state === 'PAID' ? 'done' : p.state === 'FAILED' ? 'stop' : 'wait'}>{p.state.toLowerCase()}</Pill></td>
                  <td className="mono muted">{p.providerRef ?? '–'}</td>
                  <td className="right">
                    {p.state === 'PENDING' ? <>
                      <button className="btn small primary" onClick={() => confirm({ title: `Mark ${rupees(p.amount)} paid to ${p.technicianName}?`, body: 'Only after the money was sent. The technician sees it in the app.', confirm: 'Mark paid', reason: { label: 'Bank / UPI reference', required: true }, run: async ({ reason }) => { await api.payoutPaid(p.id, reason); list.reload(); }, done: 'Marked paid' })}>Mark paid</button>{' '}
                      <button className="btn small" onClick={() => confirm({ title: 'Mark as failed?', body: 'The amount goes into next Monday’s payout.', confirm: 'Mark failed', danger: true, run: async () => { await api.payoutFailed(p.id); list.reload(); }, done: 'Marked failed' })}>Failed</button>
                    </> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
