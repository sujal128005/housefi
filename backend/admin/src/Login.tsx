// Sign-in: the official username and password, then Windows Hello (face, fingerprint or PIN). The first sign-in
// registers this laptop's Windows Hello; later ones only check it.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from './api.ts';

type Step = 'PASSWORD' | 'PASSKEY';

function message(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'RATE_LIMITED') return `Too many tries. Wait ${Math.ceil((e.retryAfterSec ?? 60) / 60)} min and try again.`;
    if (e.status === 401) return e.message === 'wrong username or password' ? 'That username and password do not match.' : 'That did not work. Sign in again.';
    if (e.status === 404) return 'This page is not available here.';
    return 'Something went wrong. Try again.';
  }
  if (e instanceof Error && /NotAllowed|cancel|timed out/i.test(`${e.name} ${e.message}`)) return 'Windows Hello was cancelled. Try again.';
  return 'Something went wrong. Try again.';
}

export function Login({ onSignedIn, onForgot }: { readonly onSignedIn: () => void; readonly onForgot: () => void }) {
  const [step, setStep] = useState<Step>('PASSWORD');
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.password(username, password);
      setPassword('');
      setRegister(r.next === 'REGISTER');
      setStep('PASSKEY');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const passkey = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { mode, options } = await api.passkeyOptions();
      const response = mode === 'REGISTER'
        ? await startRegistration({ optionsJSON: options as Parameters<typeof startRegistration>[0]['optionsJSON'] })
        : await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]['optionsJSON'] });
      await api.passkeyVerify(response, navigator.platform || 'Laptop');
      onSignedIn();
    } catch (err) {
      setError(message(err));
      if (err instanceof ApiError && err.status === 401 && err.message !== 'the face, fingerprint or PIN check did not pass') setStep('PASSWORD');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-art" aria-hidden>
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="auth-brand">
          <div className="logo-mark big">H</div>
          <h2>Housefi HQ</h2>
          <p>Every booking, technician and alert, in one place.</p>
        </div>
      </div>
      <div className="auth-panel">
        {step === 'PASSWORD' ? (
          <form className="auth-card" onSubmit={(e) => void submitPassword(e)}>
            <h1>Sign in</h1>
            <p className="muted">Super admins only. Every sign-in is recorded.</p>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus spellCheck={false} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
            {error ? <div className="alert">{error}</div> : null}
            <button className="btn primary wide" disabled={busy || !username || !password}>{busy ? 'Checking…' : 'Continue'}</button>
            <button type="button" className="link" onClick={onForgot}>Forgot password?</button>
          </form>
        ) : (
          <div className="auth-card">
            <div className="hello-icon" aria-hidden>
              <svg viewBox="0 0 48 48" width="56" height="56"><circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="2.5" /><circle cx="17" cy="20" r="2.5" fill="currentColor" /><circle cx="31" cy="20" r="2.5" fill="currentColor" /><path d="M16 30c4.5 4.5 11.5 4.5 16 0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
            </div>
            <h1>{register ? 'Set up Windows Hello' : 'Windows Hello'}</h1>
            <p className="muted">
              {register
                ? 'First sign-in on this laptop: register your face, fingerprint or PIN. From now on it is asked after your password every time.'
                : 'Confirm it is you with your face, fingerprint or PIN.'}
            </p>
            {error ? <div className="alert">{error}</div> : null}
            <button className="btn primary wide" onClick={() => void passkey()} disabled={busy}>{busy ? 'Waiting for Windows Hello…' : register ? 'Register Windows Hello' : 'Use Windows Hello'}</button>
            <button type="button" className="link" onClick={() => setStep('PASSWORD')}>Back</button>
          </div>
        )}
      </div>
    </div>
  );
}
