// Technician app: while online, checks for job offers and opens the offer screen with a ring and vibration you can feel;
// other updates (quote approved, customer asked for a lower price, payment received, job cancelled) show as a toast with
// a sound unless that job's screen is already open.
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import type { NotificationKind } from '../services/api';
import { feedback } from '../services/feedback';
import { useBackend } from '../services/ServicesProvider';
import { useAppState } from '../state/AppState';
import { useNotificationText } from './Notifications';
import { useToast } from './Overlays';

const TOASTS: Partial<Record<NotificationKind, 'success' | 'notify' | 'warning' | 'cash'>> = {
  QUOTE_APPROVED: 'success', QUOTE_REVISION: 'notify', QUOTE_DECLINED: 'warning', EXTRA_APPROVED: 'success', EXTRA_DECLINED: 'warning',
  PAYMENT_RECEIVED: 'cash', JOB_CANCELLED: 'warning', PROFILE_APPROVED: 'success', PROFILE_NEEDS_CORRECTION: 'warning',
};

export function TechAlerts() {
  const backend = useBackend();
  const toast = useToast();
  const text = useNotificationText();
  const pathname = usePathname();
  const { techSession, prefs } = useAppState();
  const path = useRef(pathname);
  path.current = pathname;
  const lastOffer = useRef<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const firstRun = useRef(true);
  const token = prefs.role === 'TECHNICIAN' ? techSession?.token ?? null : null;
  const approved = techSession?.profile.verification === 'APPROVED';

  useEffect(() => {
    if (!token) return;
    let alive = true;
    firstRun.current = true;
    const tick = async () => {
      if (approved) {
        const offer = await backend.tech.offer(token).catch(() => null);
        if (!alive) return;
        if (offer && offer.id !== lastOffer.current) {
          lastOffer.current = offer.id;
          if (!path.current.startsWith('/tech/offer/')) {
            feedback('offer');
            router.push(`/tech/offer/${offer.id}`);
          }
        }
      }
      const list = await backend.tech.notifications.list(token).catch(() => null);
      if (!alive || !list) return;
      const fresh = list.filter((n) => !n.read && !seen.current.has(n.id));
      fresh.forEach((n) => seen.current.add(n.id));
      const startup = firstRun.current;
      firstRun.current = false;
      if (startup) return;
      for (const n of fresh) {
        const cue = TOASTS[n.kind];
        if (!cue || (n.bookingId && path.current === `/tech/job/${n.bookingId}`)) continue;
        feedback(cue);
        toast.show(text(n), cue === 'cash' ? 'cash' : 'notifications');
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // toast/text are stable enough; re-subscribing on every render would reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, approved, backend]);

  return null;
}
