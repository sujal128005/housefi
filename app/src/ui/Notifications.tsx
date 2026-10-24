// Notification inbox rows (customer and technician) and the customer's live alerts: when the technician's quote passes
// the AI price check, a sheet pops up anywhere in the app with repair + materials + total; other updates show a toast.
// Each alert plays a sound and a vibration (see services/feedback).
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Booking } from '../domain/types';
import { Art3D, type ArtName } from '../illustrations/Art3D';
import { formatRupees, type Locale } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import type { AppNotification, NotificationKind } from '../services/api';
import { feedback } from '../services/feedback';
import { useBackend } from '../services/ServicesProvider';
import { useAppState } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { PriceCheckPill, QuoteSplit } from './BookingParts';
import { Button } from './Button';
import { Icon } from './Icon';
import { Sheet, useToast } from './Overlays';
import { Divider } from './Surfaces';
import { Tap } from './Tap';
import { Txt } from './Txt';
import { startPolling } from '../state/polling';

const ART: Record<NotificationKind, ArtName> = {
  TECH_ASSIGNED: 'tech_man', TECH_ON_THE_WAY: 'scooter', TECH_ARRIVED: 'handshake', QUOTE_READY: 'clipboard', EXTRA_QUOTE: 'memo',
  PAYMENT_DUE: 'money', BOOKING_COMPLETED: 'party', BOOKING_CANCELLED: 'package', NO_TECHNICIAN: 'no_results', JOB_OFFER: 'job_offer',
  QUOTE_APPROVED: 'check', QUOTE_REVISION: 'memo', QUOTE_DECLINED: 'package', EXTRA_APPROVED: 'check', EXTRA_DECLINED: 'package',
  PAYMENT_RECEIVED: 'pay_success', JOB_CANCELLED: 'package', PROFILE_APPROVED: 'verify_ok', PROFILE_NEEDS_CORRECTION: 'verify_fix',
  PAY_REMINDER: 'pay_due', BOOKING_REMINDER: 'alarm', JOB_REMINDER: 'alarm', QUOTE_REMINDER: 'hourglass', RATE_REMINDER: 'star',
  PROFILE_SUSPENDED: 'locked', PROFILE_REINSTATED: 'verify_ok', PROFILE_REJECTED: 'verify_fix',
  BOOKING_TOMORROW: 'calendar', JOB_TOMORROW: 'calendar', JOB_DAY_PLAN: 'spiral_calendar',
  CHAT_MESSAGE: 'memo', SUPPORT_REPLY: 'handshake', ANNOUNCEMENT: 'alarm',
  APPRENTICE_REQUEST: 'handshake', APPRENTICE_ACCEPTED: 'handshake', TRAINEE_JOB: 'tech_man', TRAINEE_REMOVED: 'package',
};

/** Notification text in the reader's language. */
export function useNotificationText(): (n: AppNotification) => string {
  const { t, locale } = useI18n();
  return (n) => {
    const params: Record<string, string | number> = { ...n.params };
    if (typeof n.params.amount === 'number') params.amount = formatRupees(n.params.amount);
    // HQ's announcements carry both languages: show the reader's.
    if (n.kind === 'ANNOUNCEMENT' && locale === 'te') {
      params.title = n.params.titleTe ?? n.params.title ?? '';
      params.body = n.params.bodyTe ?? n.params.body ?? '';
    }
    return t(`notif.${n.kind}`, params);
  };
}

function ago(at: number, locale: Locale, t: ReturnType<typeof useI18n>['t']): string {
  const min = Math.floor((Date.now() - at) / 60_000);
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minAgo', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('time.hourAgo', { n: h });
  return new Date(at).toLocaleDateString(locale === 'te' ? 'te-IN' : 'en-IN', { day: 'numeric', month: 'short' });
}

export function NotificationList({ items, onOpen }: { readonly items: readonly AppNotification[]; readonly onOpen: (n: AppNotification) => void }) {
  const { t, locale } = useI18n();
  const text = useNotificationText();
  if (items.length === 0) {
    return (
      <View style={styles.empty} testID="notifications-empty">
        <Art3D name="bell" size={96} shadow />
        <Txt variant="body" color="inkMuted" align="center">{t('home.notificationsEmpty')}</Txt>
      </View>
    );
  }
  return (
    <View style={styles.list} testID="notifications-list">
      {items.slice(0, 20).map((n) => (
        <Tap key={n.id} onPress={() => onOpen(n)} style={styles.row} accessibilityLabel={text(n)} testID={`notif-${n.kind}`}>
          <View style={styles.art}><Art3D name={ART[n.kind]} size={34} /></View>
          <View style={styles.flex}>
            <Txt variant="callout" weight={n.read ? 'medium' : 'semibold'}>{text(n)}</Txt>
            <Txt variant="caption" color="inkMuted">{ago(n.at, locale, t)}</Txt>
          </View>
          {!n.read ? <View style={styles.dot} /> : null}
          {n.bookingId ? <Icon name="chevron-forward" size={16} color="inkSubtle" /> : null}
        </Tap>
      ))}
    </View>
  );
}

const TOAST_KINDS: readonly NotificationKind[] = ['TECH_ASSIGNED', 'TECH_ON_THE_WAY', 'TECH_ARRIVED', 'PAYMENT_DUE', 'BOOKING_COMPLETED', 'NO_TECHNICIAN', 'BOOKING_CANCELLED', 'ANNOUNCEMENT'];

/** Customer app: watches the inbox and pops up new quotes (sheet) and other updates (toast), with sound and vibration. */
export function CustomerAlerts() {
  const { t } = useI18n();
  const backend = useBackend();
  const toast = useToast();
  const text = useNotificationText();
  const pathname = usePathname();
  const { session, prefs } = useAppState();
  const [quote, setQuote] = useState<{ n: AppNotification; booking: Booking } | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const firstRun = useRef(true);
  const path = useRef(pathname);
  path.current = pathname;
  const token = prefs.role === 'CUSTOMER' ? session?.token ?? null : null;

  useEffect(() => {
    if (!token) return;
    let alive = true;
    firstRun.current = true;
    const tick = async () => {
      const list = await backend.notifications.list(token).catch(() => null);
      if (!alive || !list) return;
      const fresh = list.filter((n) => !n.read && !seen.current.has(n.id));
      fresh.forEach((n) => seen.current.add(n.id));
      const startup = firstRun.current;
      firstRun.current = false;
      for (const n of fresh) {
        if ((n.kind === 'QUOTE_READY' || n.kind === 'EXTRA_QUOTE') && n.bookingId) {
          const b = await backend.bookings.get(token, n.bookingId).catch(() => null);
          const q = n.kind === 'QUOTE_READY' ? b?.quote : b?.extraQuote;
          const waiting = b && q && q.decision === 'PENDING' && (b.status === 'QUOTE_SHARED' || b.status === 'EXTRA_WORK');
          if (!alive || !b || !waiting) continue;
          feedback('notify');
          setQuote({ n, booking: b });
          return;
        }
        if (!startup && TOAST_KINDS.includes(n.kind) && path.current !== `/booking/${n.bookingId}`) {
          feedback(n.kind === 'BOOKING_COMPLETED' ? 'success' : n.kind === 'NO_TECHNICIAN' || n.kind === 'BOOKING_CANCELLED' ? 'warning' : 'notify');
          toast.show(text(n), 'notifications');
        }
      }
    };
    const stop = startPolling(tick, 5000);
    return () => {
      alive = false;
      stop();
    };
    // text/toast are stable enough per render; re-subscribing on each render would reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, backend]);

  const close = (open: boolean) => {
    if (!quote || !token) return;
    void backend.notifications.markRead(token, [quote.n.id]).catch(() => undefined);
    const id = quote.booking.id;
    setQuote(null);
    if (open && path.current !== `/booking/${id}`) router.push(`/booking/${id}`);
  };

  const q = quote ? (quote.n.kind === 'QUOTE_READY' ? quote.booking.quote : quote.booking.extraQuote) : null;
  return (
    <Sheet visible={!!quote && !!q} onClose={() => close(false)} testID="quote-alert">
      {quote && q ? (
        <>
          <View style={styles.head}>
            <Art3D name={quote.n.kind === 'QUOTE_READY' ? 'clipboard' : 'memo'} size={64} float />
            <View style={styles.flex}>
              <Txt variant="title2" heading>{quote.n.kind === 'QUOTE_READY' ? t('alert.quoteTitle') : t('alert.extraTitle')}</Txt>
              <Txt variant="footnote" color="inkMuted">{t('alert.quoteBody', { code: quote.booking.code })}</Txt>
            </View>
          </View>
          <PriceCheckPill quote={q} />
          <QuoteSplit quote={q} />
          <Divider />
          <View style={styles.total}>
            <Txt variant="bodyStrong" style={styles.flex}>{t('quote.total')}</Txt>
            <Txt variant="title1" testID="alert-total">{formatRupees(q.total)}</Txt>
          </View>
          <Button label={t('alert.review')} icon="document-text" onPress={() => close(true)} testID="alert-review" />
          <Button label={t('alert.later')} variant="ghost" onPress={() => close(false)} testID="alert-later" />
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.lg },
  list: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingHorizontal: space.sm, borderRadius: radius.md },
  art: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  total: { flexDirection: 'row', alignItems: 'center' },
});
