// Housefi HQ: sign-in (password, then Windows Hello), "forgot password", and the portal itself. Laptops only.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, isSmallOrMobile, type Me } from './api.ts';
import { Login } from './Login.tsx';
import { Recovery } from './Recovery.tsx';
import { Shell } from './Shell.tsx';

type View = { kind: 'loading' } | { kind: 'login' } | { kind: 'recovery' } | { kind: 'in'; me: Me };

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [small, setSmall] = useState(() => isSmallOrMobile(navigator.userAgent, window.innerWidth));

  useEffect(() => {
    const onResize = () => setSmall(isSmallOrMobile(navigator.userAgent, window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const load = useCallback(async () => {
    try {
      setView({ kind: 'in', me: await api.me() });
    } catch (e) {
      setView(e instanceof ApiError && e.status === 401 ? { kind: 'login' } : { kind: 'login' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A session that ended while the portal was open (idle for 30 minutes, or signed out elsewhere) shows the sign-in.
  useEffect(() => {
    const onExpired = () => setView({ kind: 'login' });
    window.addEventListener('hq:signed-out', onExpired);
    return () => window.removeEventListener('hq:signed-out', onExpired);
  }, []);

  if (small) {
    return (
      <div className="gate">
        <div className="gate-card">
          <img className="logo-img big" src="/logo.png" alt="Housefi" />
          <h1>Housefi HQ opens on a laptop</h1>
          <p>For security, the portal works only on a laptop or a big screen, with the window wide enough.</p>
        </div>
      </div>
    );
  }
  if (view.kind === 'loading') return <div className="gate"><div className="spinner" /></div>;
  if (view.kind === 'recovery') return <Recovery onBack={() => setView({ kind: 'login' })} />;
  if (view.kind === 'login') return <Login onSignedIn={() => void load()} onForgot={() => setView({ kind: 'recovery' })} />;
  return <Shell me={view.me} onSignedOut={() => setView({ kind: 'login' })} onRefreshMe={() => void load()} />;
}
