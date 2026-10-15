// Booking status: live matching progress, then assigned / still searching / no technician / cancelled, with the
// actions each state allows (change time, cancel) and a clearly labelled demo control to simulate outcomes.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View } from 'react-native';
import { categoryById, serviceById } from '../../data/catalog';
import { canCancel, canReschedule, matchingStep } from '../../domain/rules';
import type { Booking, CancelReason } from '../../domain/types';
import { ClockArt, EmptyBoxArt, ScooterArt, SearchArt } from '../../illustrations/Scenes';
import { formatHour, formatRupees } from '../../i18n/format';
import { useI18n, type StringKey } from '../../i18n/I18n';
import type { DemoOutcome } from '../../services/api';
import { useBackend } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { colors, radius, shadow, space } from '../../theme/tokens';
import {
  Banner, Button, Card, Chip, ConfirmSheet, Divider, EmptyState, ErrorBanner, ErrorView, Header, Icon, NotInDemoSheet, Pill, Screen, Sheet,
  Skeleton, StatusPill, Tap, Txt, useToast, type IconName,
} from '../../ui';
import { addressLine, whenText } from '../../ui/present';
import { Wash } from '../../ui/Layout';

const STEPS: readonly StringKey[] = ['track.step.received', 'track.step.searching', 'track.step.availability', 'track.step.matching'];
const REASONS: readonly CancelReason[] = ['PLANS_CHANGED', 'FIXED', 'TOO_LONG', 'MISTAKE', 'OTHER'];

export default function BookingStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const toast = useToast();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [notInDemo, setNotInDemo] = useState<string | null>(null);
  const [ackDelay, setAckDelay] = useState(false);

  useEffect(() => {
    setLoadError(null);
    return backend.bookings.watch(session.token, id, (b) => {
      setBooking(b);
      setLoadError(null);
    }, (e) => setLoadError(e));
  }, [backend, session.token, id, attempt]);

  const matching = booking?.status === 'MATCHING' || booking?.status === 'MATCHING_DELAYED';
  useEffect(() => {
    if (!matching) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [matching]);

  if (!booking) {
    return (
      <Screen header={<Header title={t('track.title')} />} testID="booking-status">
        {loadError ? <ErrorView error={loadError} onRetry={() => setAttempt((a) => a + 1)} title={t('track.notFound')} /> : (
          <><Skeleton style={styles.skelHero} /><Skeleton style={styles.skelCard} /></>
        )}
      </Screen>
    );
  }

  const b = booking;
  const svc = serviceById(b.serviceId);
  const cat = categoryById(b.categoryId);
  const elapsed = (now - b.matchingStartedAt) / 1000;
  // "Request received" is always done; the live step starts at "Searching".
  const step = b.status === 'MATCHING' ? Math.max(1, matchingStep(elapsed)) : 4;

  const doCancel = async () => {
    setBusy(true);
    setActionError(null);
    try {
      setBooking(await backend.bookings.cancel(session.token, b.id, reason));
      setCancelOpen(false);
      toast.show(t('track.cancelled.title'), 'close-circle');
    } catch (e) {
      setCancelOpen(false);
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  const simulate = async (o: DemoOutcome) => {
    if (!backend.demo) return;
    setDemoOpen(false);
    try {
      setBooking(await backend.demo.simulate(session.token, b.id, o));
    } catch (e) {
      setActionError(e);
    }
  };

  const changeTime = () => router.push({ pathname: '/book/schedule', params: { reschedule: b.id } });

  return (
    <Screen testID="booking-status" header={<Header title={t('track.title')} />}>
      {/* status hero */}
      <View style={styles.hero} testID={`status-${b.status}`}>
        {b.status === 'MATCHING' ? <Searching /> : null}
        {b.status === 'MATCHING_DELAYED' || b.status === 'UNFULFILLED' ? <View style={styles.art}><ClockArt size={150} /></View> : null}
        {b.status === 'ASSIGNED' ? <Wash name="mint" style={styles.assignedArt}><ScooterArt size={220} /></Wash> : null}
        {b.status === 'CANCELLED' ? <View style={styles.art}><EmptyBoxArt size={130} /></View> : null}
        {b.status === 'MATCHING' || b.status === 'MATCHING_DELAYED' ? <View style={styles.center}><StatusPill status={b.status} /></View> : null}
        <Txt variant="title2" align="center" heading accessibilityLiveRegion="polite" testID="status-title">
          {t(b.status === 'MATCHING' ? 'track.matching.title' : b.status === 'MATCHING_DELAYED' ? 'track.delayed.title' : b.status === 'ASSIGNED'
            ? 'track.assigned.title' : b.status === 'UNFULFILLED' ? 'track.unfulfilled.title' : 'track.cancelled.title')}
        </Txt>
        <Txt variant="callout" color="inkMuted" align="center">
          {b.status === 'MATCHING' ? t('track.matching.body') : b.status === 'MATCHING_DELAYED' ? t('track.delayed.body') : b.status === 'ASSIGNED' && b.technician
            ? t('track.assigned.body', { name: l(b.technician.name), when: whenText(b.window, locale, t) }) : b.status === 'UNFULFILLED'
              ? t('track.unfulfilled.body') : t('track.cancelled.body')}
        </Txt>
      </View>

      {b.status === 'MATCHING' || b.status === 'MATCHING_DELAYED' ? (
        <Card style={styles.steps}>
          {STEPS.map((k, i) => {
            const done = i < step || (i === 0);
            const current = i === step && b.status === 'MATCHING';
            return (
              <View key={k} style={styles.stepRow}>
                <View style={[styles.stepDot, done && styles.stepDone, current && styles.stepCurrent]}>
                  {done && !current ? <Icon name="checkmark" size={14} color="onNavy" /> : current ? <ActivityIndicator size="small" color={colors.blue} /> : null}
                </View>
                <Txt variant="callout" color={done || current ? 'ink' : 'inkSubtle'} weight={current ? 'semibold' : 'medium'} style={styles.flex}>{t(k)}</Txt>
              </View>
            );
          })}
        </Card>
      ) : null}

      {b.status === 'MATCHING_DELAYED' && !ackDelay ? (
        <View style={styles.actionsRow}>
          <Button label={t('track.keepWaiting')} variant="secondary" size="md" onPress={() => setAckDelay(true)} style={styles.flex} testID="keep-waiting" />
          <Button label={t('track.changeTime')} variant="outline" size="md" onPress={changeTime} style={styles.flex} testID="delayed-change-time" />
        </View>
      ) : null}

      {b.status === 'ASSIGNED' && b.technician ? (
        <Card style={styles.tech} testID="tech-card">
          <View style={styles.techRow}>
            <View style={styles.avatar}>
              <Txt variant="title2" color="onNavy">{l(b.technician.name).split(' ').map((w) => w[0]).join('').slice(0, 2)}</Txt>
            </View>
            <View style={styles.flex}>
              <Txt variant="title3">{l(b.technician.name)}</Txt>
              <View style={styles.meta}>
                <Icon name="star" size={14} color="yellow" />
                <Txt variant="label">{b.technician.rating.toFixed(1)}</Txt>
                <Txt variant="footnote" color="inkMuted">· {t('track.jobs', { count: b.technician.jobs })} · {t('track.experience', { years: b.technician.years })}</Txt>
              </View>
              <Pill label={t('track.verified')} tone="demo" icon="shield-checkmark" />
            </View>
          </View>
          <View style={styles.actionsRow}>
            <Button label={t('track.call')} icon="call" variant="secondary" size="md" onPress={() => setNotInDemo(t('track.call'))} style={styles.flex} />
            <Button label={t('track.message')} icon="chatbubble-ellipses" variant="secondary" size="md" onPress={() => setNotInDemo(t('track.message'))} style={styles.flex} />
          </View>
          <Banner tone="demo" text={t('track.assigned.demo')} />
        </Card>
      ) : null}
      {b.status === 'ASSIGNED' ? <Banner tone="info" icon="construct-outline" text={t('track.nextPath')} /> : null}

      {b.status === 'UNFULFILLED' ? (
        <View style={styles.stack}>
          <Button label={t('track.changeTime')} icon="calendar" onPress={changeTime} testID="unfulfilled-change-time" />
        </View>
      ) : null}
      {b.status === 'CANCELLED' && svc ? <Button label={t('track.bookAgain')} icon="refresh" onPress={() => router.push(`/service/${svc.id}`)} testID="book-again" /> : null}

      <ErrorBanner error={actionError} />

      {/* details */}
      <Card style={styles.details}>
        <View style={styles.detailHead}>
          <Txt variant="title3" heading style={styles.flex}>{t('track.details')}</Txt>
          <Txt variant="label" color="inkMuted" selectable testID="status-code">{b.code}</Txt>
        </View>
        <Detail icon="construct-outline" label={svc ? l(svc.name) : b.serviceId} sub={cat ? l(cat.name) : undefined} />
        <Detail icon="calendar-outline" label={whenText(b.window, locale, t)} />
        <Detail icon="location-outline" label={`${t(`address.label.${b.address.label}`)} · ${addressLine(b.address)}`} />
        <Detail icon="wallet-outline" label={`${t('review.visitFee')} ${formatRupees(b.visitFee)}`} sub={t('review.payLater')} />
        <Divider />
        {b.history.map((h, i) => (
          <View key={`${h.status}-${i}`} style={styles.histRow}>
            <View style={styles.histDot} />
            <Txt variant="footnote" style={styles.flex}>{t(`status.${h.status}`)}</Txt>
            <Txt variant="footnote" color="inkMuted">{clock(h.at, locale)}</Txt>
          </View>
        ))}
      </Card>

      {canReschedule(b.status) && b.status !== 'UNFULFILLED' ? <Button label={t('track.changeTime')} icon="calendar-outline" variant="outline" onPress={changeTime} testID="change-time" /> : null}
      {canCancel(b.status) ? <Button label={t('track.cancel')} icon="close-circle-outline" variant="danger" onPress={() => setCancelOpen(true)} testID="cancel-booking" /> : null}

      {backend.demo && b.status !== 'CANCELLED' ? (
        <Tap onPress={() => setDemoOpen(true)} style={styles.demoLink} accessibilityLabel={t('track.simulate')} testID="demo-simulate">
          <Icon name="flask" size={16} color="demo" />
          <Txt variant="label" color="demo">{t('track.simulate')}</Txt>
        </Tap>
      ) : null}

      <ConfirmSheet visible={cancelOpen} title={t('cancel.title')} body={t('cancel.body')} icon="close-circle" confirmLabel={t('cancel.confirm')} confirmVariant="danger"
        cancelLabel={t('cancel.keep')} onConfirm={() => void doCancel()} onCancel={() => setCancelOpen(false)} busy={busy}>
        <Txt variant="label" color="inkMuted">{t('cancel.reason')}</Txt>
        <View style={styles.chips}>
          {REASONS.map((r) => <Chip key={r} label={t(`cancel.r.${r}`)} selected={reason === r} onPress={() => setReason(reason === r ? null : r)} testID={`reason-${r}`} />)}
        </View>
      </ConfirmSheet>

      <Sheet visible={demoOpen} onClose={() => setDemoOpen(false)} testID="demo-sheet">
        <View style={styles.row}>
          <Icon name="flask" size={22} color="demo" />
          <Txt variant="title3" color="demo">{t('track.simulate')}</Txt>
        </View>
        <Txt variant="footnote" color="inkMuted">{t('demo.body')}</Txt>
        <DemoOption icon="checkmark-circle" label={t('demo.outcome.ASSIGN')} onPress={() => void simulate('ASSIGN')} testID="sim-assign" />
        <DemoOption icon="time" label={t('demo.outcome.DELAY')} onPress={() => void simulate('DELAY')} testID="sim-delay" />
        <DemoOption icon="alert-circle" label={t('demo.outcome.NONE')} onPress={() => void simulate('NONE')} testID="sim-none" />
      </Sheet>
      <NotInDemoSheet visible={notInDemo !== null} title={notInDemo ?? undefined} onClose={() => setNotInDemo(null)} />
    </Screen>
  );
}

function clock(at: number, locale: 'en' | 'te'): string {
  const d = new Date(at);
  const h = formatHour(d.getHours(), locale);
  const mm = String(d.getMinutes()).padStart(2, '0');
  return locale === 'en' ? h.replace(' ', `:${mm} `) : `${h}:${mm}`;
}

/** Map-and-magnifier illustration with soft radar pulses while matching. */
function Searching() {
  const pulse = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    const c = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    a.start();
    c.start();
    return () => {
      a.stop();
      c.stop();
    };
  }, [pulse, bob]);
  return (
    <View style={styles.searchWrap} accessibilityElementsHidden>
      <Animated.View style={[styles.ring, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.4] }) }] }]} />
      <Animated.View style={{ transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] }}>
        <SearchArt size={210} />
      </Animated.View>
    </View>
  );
}

function Detail({ icon, label, sub }: { readonly icon: IconName; readonly label: string; readonly sub?: string }) {
  return (
    <View style={styles.detailRow}>
      <Icon name={icon} size={18} color="inkMuted" />
      <View style={styles.flex}>
        <Txt variant="callout">{label}</Txt>
        {sub ? <Txt variant="footnote" color="inkMuted">{sub}</Txt> : null}
      </View>
    </View>
  );
}

function DemoOption({ icon, label, onPress, testID }: { readonly icon: IconName; readonly label: string; readonly onPress: () => void; readonly testID: string }) {
  return (
    <Tap onPress={onPress} style={styles.demoOpt} accessibilityLabel={label} testID={testID}>
      <Icon name={icon} size={20} color="demo" />
      <Txt variant="bodyStrong" style={styles.flex}>{label}</Txt>
      <Icon name="chevron-forward" size={18} color="inkSubtle" />
    </Tap>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stack: { gap: space.sm },
  skelHero: { height: 260, borderRadius: radius.xxl },
  skelCard: { height: 180, borderRadius: radius.lg },
  hero: { gap: space.sm },
  art: { alignItems: 'center' },
  assignedArt: { borderRadius: radius.xxl, alignItems: 'center', paddingTop: space.lg, paddingBottom: space.sm },
  searchWrap: { alignItems: 'center', justifyContent: 'center', height: 200 },
  ring: { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 3, borderColor: colors.blue },
  steps: { gap: space.md },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  stepDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepCurrent: { backgroundColor: colors.surface, borderColor: colors.blue },
  actionsRow: { flexDirection: 'row', gap: space.sm },
  tech: { gap: space.md, borderColor: colors.successTint, borderWidth: 2 },
  techRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginVertical: 2 },
  details: { gap: space.md },
  detailHead: { flexDirection: 'row', alignItems: 'center' },
  detailRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  histDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.blue },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  demoLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.demo },
  demoOpt: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.demoTint },
});
