// "Forgot password": username, the phone on the account and the one-time code; then a waiting time of 2 to 5 hours
// that no one can shorten (signing in normally cancels it). Afterwards, in this same browser, a new password.
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, timeLeft } from './api.ts';

type Stage = { kind: 'checking' } | { kind: 'start' } | { kind: 'waiting'; readyAt: number } | { kind: 'ready' } | { kind: 'over'; done: boolean };

export function Recovery({ onBack }: { readonly onBack: () => void }) {
  const [stage, setStage] = useState<Stage>({ kind: 'checking' });
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const check = async () => {
    try {
      const s = await api.recoveryStatus();
      setStage(s.state === 'WAITING' ? { kind: 'waiting', readyAt: s.readyAt } : s.state === 'READY' ? { kind: 'ready' } : { kind: 'over', done: s.state === 'DONE' });
    } catch {
      setStage({ kind: 'start' });
    }
  };

  useEffect(() => {
    void check();
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (stage.kind === 'waiting' && now >= stage.readyAt) void check();
  }, [now, stage]);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.recoveryStart(username, phone, code);
      setStage({ kind: 'waiting', readyAt: r.readyAt });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'RATE_LIMITED' ? 'Too many tries. Try again later.' : 'Those details do not match an account.');
    } finally {
      setBusy(false);
    }
  };

  const complete = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError('The two passwords are not the same.');
    setBusy(true);
    setError(null);
    try {
      await api.recoveryComplete(password);
      setStage({ kind: 'over', done: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 422 ? 'Use at least 16 characters, without your name.' : 'That did not work. Start the recovery again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth single">
      <div className="auth-panel">
        <div className="auth-card">
          <h1>Account recovery</h1>
          {stage.kind === 'checking' ? <div className="spinner" /> : null}
          {stage.kind === 'start' ? (
            <form onSubmit={(e) => void start(e)}>
              <p className="muted">For your safety, after these checks there is a waiting time of 2 to 5 hours before you can set a new password. No one can shorten it. If you sign in normally meanwhile, the recovery is cancelled.</p>
              <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} required /></label>
              <label>Phone number on the account<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required /></label>
              <label>One-time code<input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required /></label>
              {error ? <div className="alert">{error}</div> : null}
              <button className="btn primary wide" disabled={busy}>{busy ? 'Checking…' : 'Start recovery'}</button>
            </form>
          ) : null}
          {stage.kind === 'waiting' ? (
            <div className="wait">
              <div className="wait-ring" aria-hidden><span>{timeLeft(stage.readyAt - now).replace('in ', '')}</span></div>
              <p>You can set a new password <b>{timeLeft(stage.readyAt - now)}</b>, at {new Date(stage.readyAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>
              <p className="muted">Come back to this page in this same browser. The waiting time cannot be shortened.</p>
            </div>
          ) : null}
          {stage.kind === 'ready' ? (
            <form onSubmit={(e) => void complete(e)}>
              <p className="muted">Choose a new password: at least 16 characters. Keep it in the password manager.</p>
              <label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /></label>
              <label>Again<input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required /></label>
              {error ? <div className="alert">{error}</div> : null}
              <button className="btn primary wide" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
            </form>
          ) : null}
          {stage.kind === 'over' ? (
            <p>{stage.done ? 'Your password is changed. Sign in with it; Windows Hello is still needed.' : 'This recovery was cancelled (someone signed in to the account, or a newer recovery was started).'}</p>
          ) : null}
          <button type="button" className="link" onClick={onBack}>Back to sign-in</button>
        </div>
      </div>
    </div>
  );
}
