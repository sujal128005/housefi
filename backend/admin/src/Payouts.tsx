// Weekly payouts (every Monday): prepare one payout per technician for the week to Sunday, pay each by bank / UPI,
// then mark it paid with the transfer reference (or failed: it goes into next Monday's run).
import { useState } from 'react';
import { api, rupees } from './api.ts';
import { Empty, PageHead, Pill, Segmented, TableSkeleton, useActions, useLoad } from './ui.tsx';

export function Payouts() {
  const [state, setState] = useState<'PENDING' | 'PAID' | 'FAILED'>('PENDING');
  const list = useLoad(() => api.payouts(state), [state]);
  const { confirm, toast } = useActions();
  const total = (list.data ?? []).reduce((s, p) => s + p.amount, 0);

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
      </PageHead>
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
