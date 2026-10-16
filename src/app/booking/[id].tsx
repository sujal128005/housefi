// Booking hub: everything after paying the visit fee, live. Finding a technician -> assigned (scooter rides in) ->
// on the way (live map, ETA) -> arrived (share OTP) -> inspecting -> quote (approve / reject) -> repair (extra work) ->
// pay -> completed (receipt, rating). Cancel / change time where allowed; safety tools while the visit is live.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import { categoryById, serviceById } from '../../data/catalog';
import { canCancel, cancelRefundsVisitFee, canReschedule, DEMO_TIMING, isVisitLive, matchingStep, MAX_QUOTE_VERSIONS } from '../../domain/rules';
import type { Booking, CancelReason } from '../../domain/types';
import { Art3D, type ArtName } from '../../illustrations/Art3D';
import { TrackingMap } from '../../illustrations/TrackingMap';
import { formatHour, formatRupees } from '../../i18n/format';
import { useI18n, type StringKey } from '../../i18n/I18n';
import type { DemoOutcome } from '../../services/api';
import { useBackend } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { colors, GUTTER, radius, space } from '../../theme/tokens';
import {
  Banner, Button, Card, Chip, ConfirmSheet, Divider, ErrorBanner, ErrorView, Header, Icon, Screen, Sheet, Skeleton, Tap, Txt, useToast, type IconName,
} from '../../ui';
import { ArrivalOtpCard, BillCard, ProgressStepper, QuoteCard, SafetyRow, TechnicianCard } from '../../ui/BookingParts';
import { Appear, Pop, Pulse, RideIn } from '../../ui/motion';
import { PhotoThumb } from '../../ui/PhotoThumb';
import { addressLine, visitTimeText } from '../../ui/present';
import { feedback } from '../../services/feedback';

const STEPS: readonly StringKey[] = ['track.step.received', 'track.step.searching', 'track.step.availability', 'track.step.matching'];
const REASONS: readonly CancelReason[] = ['PLANS_CHANGED', 'FIXED', 'TOO_LONG', 'MISTAKE', 'OTHER'];

const HERO: Partial<Record<Booking['status'], { art: ArtName; title: StringKey; body: StringKey }>> = {
  AWAITING_PAYMENT: { art: 'card', title: 'hub.awaiting.title', body: 'hub.awaiting.body' },
  PAYMENT_PENDING: { art: 'pay_pending', title: 'hub.payPending.title', body: 'hub.payPending.body' },
  MATCHING_DELAYED: { art: 'alarm', title: 'track.delayed.title', body: 'track.delayed.body' },
  UNFULFILLED: { art: 'alarm', title: 'track.unfulfilled.title', body: 'track.unfulfilled.body' },
  ARRIVED: { art: 'handshake', title: 'hub.arrived.title', body: 'hub.arrived.body' },
  INSPECTING: { art: 'inspecting', title: 'hub.inspecting.title', body: 'hub.inspecting.body' },
  QUOTE_SHARED: { art: 'clipboard', title: 'hub.quote.title', body: 'hub.quote.body' },
  IN_PROGRESS: { art: 'tools', title: 'hub.working.title', body: 'hub.working.body' },
  EXTRA_WORK: { art: 'memo', title: 'hub.extra.title', body: 'hub.extra.body' },
  PAYMENT_DUE: { art: 'pay_due', title: 'hub.due.title', body: 'hub.due.body' },
  CLOSED_NO_REPAIR: { art: 'check', title: 'hub.noRepair.title', body: 'hub.noRepair.body' },
  CANCELLED: { art: 'package', title: 'track.cancelled.title', body: 'track.cancelled.body' },
};

export default function BookingHub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [ackDelay, setAckDelay] = useState(false);

  useEffect(() => {
    setLoadError(null);
    return backend.bookings.watch(session.token, id, (b) => {
      setBooking(b);
      setLoadError(null);
    }, (e) => setLoadError(e));
  }, [backend, session.token, id, attempt]);

  // Sound and vibration as the visit moves on while this screen is open.
  const status = booking?.status;
  const lastStatus = useRef(status);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (!prev || !status || prev === status) return;
    if (status === 'ASSIGNED' || status === 'COMPLETED') feedback('success');
    else if (status === 'EN_ROUTE' || status === 'ARRIVED' || status === 'QUOTE_SHARED' || status === 'EXTRA_WORK' || status === 'PAYMENT_DUE') feedback('notify');
    else if (status === 'UNFULFILLED' || status === 'MATCHING_DELAYED') feedback('warning');
  }, [status]);

  const ticking = booking?.status === 'MATCHING';
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [ticking]);

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
  const lastAt = b.history[b.history.length - 1]?.at ?? b.createdAt;
  const step = b.status === 'MATCHING' ? Math.max(1, matchingStep((now - lastAt) / 1000)) : 4;
  const live = isVisitLive(b.status);
  const showOtp = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(b.status);
  const mapProgress = b.etaMin !== null ? 1 - b.etaMin / DEMO_TIMING.travelShownMin : 0;

  const act = async (f: () => Promise<Booking>, okMsg?: string) => {
    setBusy(true);
    setActionError(null);
    try {
      setBooking(await f());
      if (okMsg) toast.show(okMsg, 'checkmark-circle');
    } catch (e) {
      feedback('error');
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    setCancelOpen(false);
    await act(() => backend.bookings.cancel(session.token, b.id, reason), t('track.cancelled.title'));
  };

  const simulate = async (o: DemoOutcome) => {
    if (!backend.demo) return;
    setDemoOpen(false);
    await act(() => backend.demo!.simulate(session.token, b.id, o));
  };

  const changeTime = () => router.push({ pathname: '/book/when', params: { reschedule: b.id } });
  const revising = b.status === 'QUOTE_SHARED' && b.quote?.decision === 'REVISION_REQUESTED';
  const hero = revising ? { art: 'hourglass' as ArtName, title: 'hub.revision.title' as StringKey, body: 'hub.revision.body' as StringKey } : HERO[b.status];

  return (
    <Screen testID="booking-status" header={<Header title={`${t('track.title')} · ${b.code}`} />}>
      <ProgressStepper booking={b} />

      {/* status hero */}
      <View style={styles.hero} testID={`status-${b.status}`}>
        {b.status === 'MATCHING' ? (
          <View style={styles.art}>
            <Pulse size={190} color={colors.blue} />
            <Art3D name="finding" size={120} float />
          </View>
        ) : null}
        {b.status === 'ASSIGNED' ? (
          <View style={styles.ride}>
            <RideIn distance={width}>
              <Art3D name="scooter" size={140} shadow />
            </RideIn>
          </View>
        ) : null}
        {b.status === 'EN_ROUTE' ? (
          <View style={styles.map}>
            <TrackingMap progress={mapProgress} width={width - GUTTER * 2} />
            <View style={styles.eta}>
              <Txt variant="caption" color="onNavy">{t('hub.eta')}</Txt>
              <Txt variant="title1" color="onNavy" testID="eta">{t('hub.etaMin', { min: b.etaMin ?? 0 })}</Txt>
            </View>
          </View>
        ) : null}
        {b.status === 'COMPLETED' ? (
          <View style={styles.art}>
            <Pop><Art3D name="party" size={120} shadow /></Pop>
          </View>
        ) : null}
        {hero ? <View style={styles.art}><Art3D name={hero.art} size={hero.art === 'handshake' ? 120 : 110} float={live} shadow /></View> : null}

        <Txt variant="title2" align="center" heading accessibilityLiveRegion="polite" testID="status-title">
          {b.status === 'MATCHING' ? t('track.matching.title') : b.status === 'ASSIGNED' ? t('track.assigned.title') : b.status === 'EN_ROUTE' ? t('hub.enroute.title')
            : b.status === 'COMPLETED' ? t('hub.done.title') : hero ? t(hero.title) : ''}
        </Txt>
        <Txt variant="callout" color="inkMuted" align="center">
          {b.status === 'MATCHING' ? t('track.matching.body')
            : b.status === 'ASSIGNED' && b.technician ? (b.time.mode === 'INSTANT' ? t('hub.assignedNow', { name: l(b.technician.name) }) : t('track.assigned.body', { name: l(b.technician.name), when: visitTimeText(b.time, locale, t) }))
              : b.status === 'EN_ROUTE' && b.technician ? t('hub.enroute.body', { name: l(b.technician.name) })
                : b.status === 'COMPLETED' ? t('hub.done.body')
                  : b.status === 'CANCELLED' ? t(cancelledBody(b))
                    : b.status === 'CLOSED_NO_REPAIR' ? t(closedBody(b))
                    : hero ? t(hero.body) : ''}
        </Txt>
        {b.status === 'EN_ROUTE' ? <Txt variant="caption" color="demo" align="center">{t('hub.spedUp')}</Txt> : null}
      </View>

      {/* status-specific actions */}
      {b.status === 'AWAITING_PAYMENT' ? (
        <View style={styles.stack}>
          <Button label={t('confirm.pay', { amount: formatRupees(b.visitPayment.amount) })} icon="lock-closed" onPress={() => router.push({ pathname: '/pay', params: { id: b.id, kind: 'VISIT' } })} testID="hub-pay-visit" />
          <Button label={t('hub.discard')} variant="outline" onPress={() => void act(() => backend.bookings.cancel(session.token, b.id, null))} testID="hub-discard" />
        </View>
      ) : null}
      {b.status === 'PAYMENT_PENDING' ? <View style={styles.center}><ActivityIndicator color={colors.warning} /></View> : null}

      {b.status === 'MATCHING' ? (
        <Card style={styles.steps}>
          {STEPS.map((k, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <View key={k} style={styles.stepRow}>
                <View style={[styles.stepDot, done && styles.stepDone, current && styles.stepCurrent]}>
                  {done ? <Icon name="checkmark" size={14} color="onNavy" /> : current ? <ActivityIndicator size="small" color={colors.blue} /> : null}
                </View>
                <Txt variant="callout" color={done || current ? 'ink' : 'inkSubtle'} weight={current ? 'semibold' : 'medium'} style={styles.flex}>{t(k)}</Txt>
              </View>
            );
          })}
        </Card>
      ) : null}

      {b.status === 'MATCHING_DELAYED' && !ackDelay ? (
        <View style={styles.row}>
          <Button label={t('track.keepWaiting')} variant="secondary" size="md" onPress={() => setAckDelay(true)} style={styles.flex} testID="keep-waiting" />
          <Button label={t('track.changeTime')} variant="outline" size="md" onPress={changeTime} style={styles.flex} testID="delayed-change-time" />
        </View>
      ) : null}

      {b.status === 'UNFULFILLED' ? <Button label={t('track.changeTime')} icon="calendar" onPress={changeTime} testID="unfulfilled-change-time" /> : null}

      {showOtp ? <ArrivalOtpCard code={b.arrivalOtp} highlight={b.status === 'ARRIVED'} /> : null}

      {b.technician && !['CANCELLED', 'UNFULFILLED'].includes(b.status) ? <TechnicianCard tech={b.technician} booking={b} /> : null}

      {b.status === 'QUOTE_SHARED' && b.quote ? (
        <Appear>
          <QuoteCard quote={b.quote} title={t('quote.title')} busy={busy}
            onApprove={() => void act(() => backend.bookings.decideQuote(session.token, b.id, 'MAIN', 'APPROVE'), t('quote.approved'))}
            onRevision={b.quote.version < MAX_QUOTE_VERSIONS ? () => void act(() => backend.bookings.decideQuote(session.token, b.id, 'MAIN', 'REVISION'), t('quote.askedLower')) : undefined}
            onReject={() => void act(() => backend.bookings.decideQuote(session.token, b.id, 'MAIN', 'DECLINE'))} />
        </Appear>
      ) : null}

      {b.status === 'EXTRA_WORK' && b.extraQuote ? (
        <Appear>
          <QuoteCard extra quote={b.extraQuote} title={t('quote.extraTitle')} busy={busy}
            onApprove={() => void act(() => backend.bookings.decideQuote(session.token, b.id, 'EXTRA', 'APPROVE'), t('quote.approved'))}
            onReject={() => void act(() => backend.bookings.decideQuote(session.token, b.id, 'EXTRA', 'DECLINE'))} />
        </Appear>
      ) : null}

      {b.status === 'IN_PROGRESS' ? (
        <Card style={styles.steps}>
          <CheckRow done label={t('hub.w1')} />
          {b.extraQuote ? <CheckRow done label={t(b.extraQuote.decision === 'APPROVED' ? 'hub.w2a' : 'hub.w2r')} /> : null}
          {b.workStarted ? <CheckRow current label={t('hub.w3')} /> : <CheckRow current label={t('hub.wStart')} />}
          <CheckRow label={t('hub.w4')} />
        </Card>
      ) : null}

      {['PAYMENT_DUE', 'COMPLETED'].includes(b.status) ? <BillCard booking={b} /> : null}
      {b.status === 'PAYMENT_DUE' ? (
        <View style={styles.stack}>
          {b.finalPayment?.state === 'PENDING' && b.finalPayment.method !== 'CASH' ? <Banner tone="warning" icon="hourglass" text={t('pay.pendingBody')} /> : null}
          {b.finalPayment?.state === 'FAILED' ? <Banner tone="danger" text={t('pay.lastFailed')} /> : null}
          <Button label={t('hub.payFinal', { amount: formatRupees(b.finalPayment?.amount ?? 0) })} icon="lock-closed" disabled={b.finalPayment?.state === 'PENDING'}
            onPress={() => router.push({ pathname: '/pay', params: { id: b.id, kind: 'FINAL' } })} testID="hub-pay-final" />
        </View>
      ) : null}

      {['COMPLETED', 'CLOSED_NO_REPAIR'].includes(b.status) ? (
        <View style={styles.stack}>
          {b.rating ? (
            <Banner tone="success" icon="star" text={t('hub.rated', { stars: b.rating.stars })} testID="hub-rated" />
          ) : (
            <Button label={t('hub.rate')} icon="star" onPress={() => router.push({ pathname: '/booking/rate', params: { id: b.id } })} testID="hub-rate" />
          )}
          <Button label={t('pay.viewReceipt')} icon="receipt-outline" variant="outline" onPress={() => router.push({ pathname: '/booking/receipt', params: { id: b.id } })} testID="hub-receipt" />
        </View>
      ) : null}

      {b.status === 'CANCELLED' && svc ? <Button label={t('track.bookAgain')} icon="refresh" onPress={() => router.push(`/service/${svc.id}`)} testID="book-again" /> : null}

      <ErrorBanner error={actionError} />

      {live ? <SafetyRow booking={b} /> : null}

      <Tap onPress={() => router.push('/support')} style={styles.help} accessibilityLabel={t('hub.help')} testID="hub-help">
        <Art3D name="robot" size={40} />
        <View style={styles.flex}>
          <Txt variant="bodyStrong">{t('hub.help')}</Txt>
          <Txt variant="footnote" color="inkMuted">{t('hub.helpSub')}</Txt>
        </View>
        <Icon name="chevron-forward" size={18} color="inkSubtle" />
      </Tap>

      {/* details */}
      <Card style={styles.details}>
        <View style={styles.detailHead}>
          <Txt variant="title3" heading style={styles.flex}>{t('track.details')}</Txt>
          <Txt variant="label" color="inkMuted" selectable testID="status-code">{b.code}</Txt>
        </View>
        <Detail icon="construct-outline" label={svc ? l(svc.name) : b.serviceId} sub={cat ? l(cat.name) : undefined} />
        <Detail icon="calendar-outline" label={visitTimeText(b.time, locale, t)} />
        <Detail icon="location-outline" label={`${t(`address.label.${b.address.label}`)} · ${addressLine(b.address)}, ${b.address.city}`} />
        <Detail icon="wallet-outline" label={`${t('confirm.visitFee')} ${formatRupees(b.visitPayment.amount)}`} sub={t(`pay.state.${b.visitPayment.state}`)} />
        {b.preferWomenRated ? <Detail icon="heart-outline" label={t('confirm.women')} /> : null}
        {b.problem.photos.length > 0 ? <View style={styles.thumbs}>{b.problem.photos.map((p) => <PhotoThumb key={p.id} photo={p} size={56} />)}</View> : null}
        <Divider />
        {b.history.map((h, i) => (
          <View key={`${h.status}-${i}`} style={styles.histRow}>
            <View style={styles.histDot} />
            <Txt variant="footnote" style={styles.flex}>{i === 0 && h.status === 'AWAITING_PAYMENT' ? t('hub.created') : t(`status.${h.status}`)}</Txt>
            <Txt variant="footnote" color="inkMuted">{clock(h.at, locale)}</Txt>
          </View>
        ))}
      </Card>

      {canReschedule(b.status) && b.status !== 'UNFULFILLED' ? <Button label={t('track.changeTime')} icon="calendar-outline" variant="outline" onPress={changeTime} testID="change-time" /> : null}
      {canCancel(b.status) && b.status !== 'AWAITING_PAYMENT' ? <Button label={t('track.cancel')} icon="close-circle-outline" variant="danger" onPress={() => setCancelOpen(true)} testID="cancel-booking" /> : null}

      {backend.demo && !b.viaTechApp && !['CANCELLED', 'COMPLETED', 'CLOSED_NO_REPAIR'].includes(b.status) ? (
        <Tap onPress={() => setDemoOpen(true)} style={styles.demoLink} accessibilityLabel={t('track.simulate')} testID="demo-simulate">
          <Icon name="flask" size={16} color="demo" />
          <Txt variant="label" color="demo">{t('track.simulate')}</Txt>
        </Tap>
      ) : null}

      <ConfirmSheet visible={cancelOpen} title={t('cancel.title')} body={cancelRefundsVisitFee(b.status) ? t('cancel.bodyRefund') : t('cancel.bodyNoRefund')} icon="close-circle"
        confirmLabel={t('cancel.confirm')} confirmVariant="danger" cancelLabel={t('cancel.keep')} onConfirm={() => void doCancel()} onCancel={() => setCancelOpen(false)} busy={busy}>
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
        <DemoOption icon="play-skip-forward" label={t('demo.outcome.NEXT')} onPress={() => void simulate('NEXT')} testID="sim-next" />
        {['MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED'].includes(b.status) ? (
          <>
            <DemoOption icon="checkmark-circle" label={t('demo.outcome.ASSIGN')} onPress={() => void simulate('ASSIGN')} testID="sim-assign" />
            <DemoOption icon="time" label={t('demo.outcome.DELAY')} onPress={() => void simulate('DELAY')} testID="sim-delay" />
            <DemoOption icon="alert-circle" label={t('demo.outcome.NONE')} onPress={() => void simulate('NONE')} testID="sim-none" />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function cancelledBody(b: Booking): StringKey {
  if (b.visitPayment.state === 'REFUNDED') return 'hub.cancelRefunded';
  if (b.visitPayment.state === 'PAID') return 'hub.cancelKept';
  return 'track.cancelled.body';
}

function closedBody(b: Booking): StringKey {
  if (b.closeReason === 'CUSTOMER_UNAVAILABLE') return 'hub.noRepair.unavailable';
  if (b.closeReason === 'CANNOT_COMPLETE') return 'hub.noRepair.cannot';
  return 'hub.noRepair.body';
}

function clock(at: number, locale: 'en' | 'te'): string {
  const d = new Date(at);
  const h = formatHour(d.getHours(), locale);
  const mm = String(d.getMinutes()).padStart(2, '0');
  return locale === 'en' ? h.replace(' ', `:${mm} `) : `${h}:${mm}`;
}

function CheckRow({ label, done, current }: { readonly label: string; readonly done?: boolean; readonly current?: boolean }) {
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepDot, done && styles.stepDone, current && styles.stepCurrent]}>
        {done ? <Icon name="checkmark" size={14} color="onNavy" /> : current ? <ActivityIndicator size="small" color={colors.blue} /> : null}
      </View>
      <Txt variant="callout" color={done || current ? 'ink' : 'inkSubtle'} weight={current ? 'semibold' : 'medium'} style={styles.flex}>{label}</Txt>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stack: { gap: space.sm },
  center: { alignItems: 'center' },
  skelHero: { height: 260, borderRadius: radius.xxl },
  skelCard: { height: 180, borderRadius: radius.lg },
  hero: { gap: space.sm },
  art: { alignItems: 'center', justifyContent: 'center', minHeight: 130 },
  ride: { height: 170, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  map: { borderRadius: radius.xl, overflow: 'hidden' },
  eta: { position: 'absolute', left: space.md, bottom: space.md, backgroundColor: 'rgba(19,35,91,0.88)', borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  steps: { gap: space.md },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  stepDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepCurrent: { backgroundColor: colors.surface, borderColor: colors.blue },
  help: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 68, paddingHorizontal: space.md, borderRadius: radius.lg, backgroundColor: colors.demoTint },
  details: { gap: space.md },
  detailHead: { flexDirection: 'row', alignItems: 'center' },
  detailRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  thumbs: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  histDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.blue },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  demoLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.demo },
  demoOpt: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.demoTint },
});
