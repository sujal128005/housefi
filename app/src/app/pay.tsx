// Payment (simulated): the ₹49 visit fee (?kind=VISIT) or the final bill (?kind=FINAL). Pick a method, pay, and see the
// outcome: paid, pending (confirms shortly), cash (the technician confirms) or failed (nothing taken). Every outcome is
// labelled as a demo. Coming from "Confirm & pay" (?auto=1) the chosen method is charged straight away.
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { Booking, PaymentMethod } from '../domain/types';
import { Art3D } from '../illustrations/Art3D';
import { formatRupees } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { useBackend, useIsDemo, useQuery } from '../services/ServicesProvider';
import { useSession } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { Banner, Button, Card, ErrorBanner, ErrorView, Header, Icon, RadioDot, Screen, Skeleton, Tap, Txt } from '../ui';
import { Appear, Celebrate, Pulse } from '../ui/motion';
import { PAY_METHODS } from '../ui/payMethods';
import { feedback } from '../services/feedback';
import { idempotencyKeys, outcomeUnknown } from '../state/idempotency';
import { takePayIntent } from '../state/payIntent';

type Phase = 'CHOOSE' | 'PROCESSING' | 'PAID' | 'PENDING' | 'CASH' | 'FAILED';

function amountFor(b: Booking, kind: 'VISIT' | 'FINAL'): number {
  return kind === 'VISIT' ? b.visitPayment.amount : b.finalPayment?.amount ?? 0;
}

export default function Pay() {
  const params = useLocalSearchParams<{ id: string; kind?: string; method?: string; auto?: string }>();
  const kind: 'VISIT' | 'FINAL' = params.kind === 'FINAL' ? 'FINAL' : 'VISIT';
  const { t, l } = useI18n();
  const backend = useBackend();
  /** Labels about simulated backend outcomes show only with the demo backend. */
  const isDemo = useIsDemo();
  const session = useSession();
  const q = useQuery(() => backend.bookings.get(session.token, params.id), [backend, session.token, params.id]);
  // A method from the link is used only if it is one the app offers.
  const [method, setMethod] = useState<PaymentMethod>(PAY_METHODS.find((m) => m.method === params.method)?.method ?? 'UPI');
  const [phase, setPhase] = useState<Phase>('CHOOSE');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<unknown>(null);
  // One key per payment attempt: a retry after a lost answer gets the first result and never charges twice.
  const [payKeys] = useState(() => idempotencyKeys(randomUUID));
  // The screen reused for another booking or bill starts over: nothing from the previous one is shown or paid.
  const [shownFor, setShownFor] = useState(`${params.id}|${kind}`);
  if (shownFor !== `${params.id}|${kind}`) {
    setShownFor(`${params.id}|${kind}`);
    setBooking(null);
    setPhase('CHOOSE');
    setError(null);
  }
  const b = booking ?? q.data ?? null;
  const payment = b ? (kind === 'VISIT' ? b.visitPayment : b.finalPayment) : null;
  // Opened again for a bill that is already paid or still settling (an old link, a reload): show that, never "Pay".
  const shown: Phase = phase === 'CHOOSE' && payment?.state === 'PAID' ? 'PAID'
    : phase === 'CHOOSE' && payment?.state === 'PENDING' ? (payment.method === 'CASH' ? 'CASH' : 'PENDING')
      : phase;
  const methods = kind === 'VISIT' ? PAY_METHODS.filter((m) => m.method !== 'CASH') : PAY_METHODS;

  const goToBooking = () => {
    if (router.canDismiss()) router.dismissAll();
    router.push(`/booking/${params.id}`);
  };

  // While pending (bank) or waiting for the technician to confirm cash, keep checking until the payment is settled.
  useEffect(() => {
    if (shown !== 'PENDING' && shown !== 'CASH') return;
    const id = setInterval(() => {
      void backend.bookings.get(session.token, params.id).then((nb) => {
        setBooking(nb);
        const p = kind === 'VISIT' ? nb.visitPayment : nb.finalPayment;
        if (p?.state === 'PAID') {
          feedback(p.method === 'CASH' ? 'cash' : 'success');
          setPhase('PAID');
        } else if (p?.state === 'FAILED') {
          // A pending bank payment can still fail (nothing taken); the customer can try again.
          feedback('error');
          setPhase('FAILED');
        } else if (p?.state !== 'PENDING' || nb.status === 'CANCELLED') {
          // The booking moved on some other way (cancelled, refunded): its page says what happened.
          goToBooking();
        }
      }).catch(() => undefined);
    }, 1500);
    return () => clearInterval(id);
    // goToBooking only reads params.id, which is in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, backend, session.token, params.id, kind]);

  const pay = async () => {
    feedback('pop');
    setPhase('PROCESSING');
    setError(null);
    const key = payKeys.keyFor(JSON.stringify({ id: params.id, kind, method }));
    try {
      const [r] = await Promise.all([backend.bookings.pay(session.token, params.id, kind, method, key), new Promise((res) => setTimeout(res, 1400))]);
      payKeys.settle();
      setBooking(r.booking);
      setPhase(r.state === 'PENDING' && method === 'CASH' ? 'CASH' : r.state);
      feedback(r.state === 'PAID' ? 'success' : r.state === 'FAILED' ? 'error' : 'notify');
    } catch (e) {
      if (outcomeUnknown(e)) {
        // No answer, but the payment may have gone through: look before offering to pay again (the key is kept,
        // so paying again with the same method returns the first result instead of charging twice).
        const nb = await backend.bookings.get(session.token, params.id).catch(() => null);
        const p = nb ? (kind === 'VISIT' ? nb.visitPayment : nb.finalPayment) : null;
        if (nb && (p?.state === 'PAID' || p?.state === 'PENDING')) {
          setBooking(nb);
          feedback(p.state === 'PAID' ? 'success' : 'notify');
          setPhase(p.state === 'PAID' ? 'PAID' : p.method === 'CASH' ? 'CASH' : 'PENDING');
          return;
        }
        if (nb) setBooking(nb);
      } else {
        payKeys.settle();
      }
      feedback('error');
      setError(e);
      setPhase('CHOOSE');
    }
  };

  // Arriving from "Confirm & pay" with a method already chosen: pay at once instead of asking again.
  const autoStarted = useRef(false);
  const ready = !!b;
  // Only Confirm & pay inside the app may start the payment by itself (a link with auto=1 cannot).
  const [autoAllowed] = useState(() => params.auto === '1' && takePayIntent(params.id));
  useEffect(() => {
    if (!autoAllowed || autoStarted.current || !ready) return;
    autoStarted.current = true;
    void pay();
    // pay() only reads state that is fixed by the time the booking has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAllowed, ready]);

  const done = () => {
    if (kind === 'VISIT') {
      if (router.canDismiss()) router.dismissAll();
      router.push({ pathname: '/book/confirmed', params: { id: params.id } });
    } else {
      router.replace({ pathname: '/booking/receipt', params: { id: params.id } });
    }
  };

  const amount = b ? amountFor(b, kind) : 0;

  return (
    <Screen
      testID="pay"
      wash="lavender"
      header={<Header title={kind === 'VISIT' ? t('pay.titleVisit') : t('pay.titleFinal')} back={shown === 'CHOOSE' || shown === 'FAILED'} />}
      footer={
        shown === 'CHOOSE' ? <Button label={t('pay.cta', { amount: formatRupees(amount) })} icon="lock-closed" onPress={() => void pay()} disabled={!b} testID="pay-now" />
          : shown === 'PAID' ? <Button label={kind === 'VISIT' ? t('pay.continueVisit') : t('pay.viewReceipt')} trailingIcon="arrow-forward" variant="lime" onPress={done} testID="pay-continue" />
            : shown === 'PENDING' || shown === 'CASH' ? <Button label={t('pay.goToBooking')} variant="outline" onPress={goToBooking} testID="pay-go-booking" />
              : shown === 'FAILED' ? (
                <>
                  <Button label={t('pay.retry')} icon="refresh" onPress={() => void pay()} testID="pay-retry" />
                  <Button label={t('pay.change')} variant="outline" onPress={() => setPhase('CHOOSE')} testID="pay-change" />
                </>
              ) : undefined
      }
    >
      {q.loading && !b ? <Skeleton style={styles.skel} /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : null}
      {b ? (
        <>
          <View style={styles.amountBox}>
            <Txt variant="caption" color="inkMuted">{kind === 'VISIT' ? t('confirm.visitFee') : t('pay.finalBill')}</Txt>
            <Txt variant="hero" testID="pay-amount">{formatRupees(amount)}</Txt>
            <Txt variant="caption" color="inkMuted">{b.code}</Txt>
          </View>

          {shown === 'CHOOSE' ? (
            <Appear style={styles.stack}>
              <Txt variant="title3" heading>{t('pay.method')}</Txt>
              {methods.map((m) => (
                <Tap key={m.method} onPress={() => setMethod(m.method)} style={[styles.method, method === m.method && styles.methodOn]} testID={`paymethod-${m.method}`}
                  accessibilityRole="radio" accessibilityState={{ selected: method === m.method }} accessibilityLabel={t(`pay.m.${m.method}`)}>
                  <View style={styles.methodIcon}><Icon name={m.icon} size={20} color="navy" /></View>
                  <View style={styles.flex}>
                    <Txt variant="bodyStrong">{t(`pay.m.${m.method}`)}</Txt>
                    <Txt variant="footnote" color="inkMuted">{t(`pay.ms.${m.method}`)}</Txt>
                  </View>
                  <RadioDot on={method === m.method} />
                </Tap>
              ))}
              {payment?.state === 'FAILED' ? <Banner tone="danger" text={t('pay.lastFailed')} /> : null}
              <ErrorBanner error={error} />
              {isDemo ? <Banner tone="demo" text={t('pay.demo')} /> : null}
              <View style={styles.secure}><Icon name="shield-checkmark" size={16} color="success" /><Txt variant="footnote" color="inkMuted">{t('pay.secure')}</Txt></View>
            </Appear>
          ) : null}

          {shown === 'PROCESSING' ? (
            <View style={styles.center} testID="pay-processing">
              <View style={styles.pulseBox}>
                <Pulse size={180} color={colors.blue} />
                <Art3D name="card" size={120} float />
              </View>
              <ActivityIndicator color={colors.navy} />
              <Txt variant="title3" align="center">{t('pay.processing')}</Txt>
              <Txt variant="footnote" color="inkMuted" align="center">{t('pay.dontClose')}</Txt>
            </View>
          ) : null}

          {shown === 'PAID' ? (
            <View style={styles.center} testID="pay-success">
              <Celebrate size={150}><Art3D name="pay_success" size={132} shadow /></Celebrate>
              <Txt variant="title1" align="center" heading>{t('pay.success')}</Txt>
              <Txt variant="callout" color="inkMuted" align="center">{kind === 'VISIT' ? t('pay.successVisit') : t('pay.successFinal')}</Txt>
              <Card style={styles.receiptMini}>
                <Line label={t('pay.amount')} value={formatRupees(amount)} />
                <Line label={t('pay.method')} value={t(`pay.m.${payment?.method ?? method}`)} />
                {payment?.txnId ? <Line label={t('pay.txn')} value={payment.txnId} /> : null}
              </Card>
              {isDemo ? <Banner tone="demo" text={t('pay.demoDone')} /> : null}
            </View>
          ) : null}

          {shown === 'PENDING' ? (
            <View style={styles.center} testID="pay-pending">
              <Art3D name="pay_pending" size={132} float shadow />
              <Txt variant="title2" align="center" heading>{t('pay.pending')}</Txt>
              <Txt variant="callout" color="inkMuted" align="center">{t('pay.pendingBody')}</Txt>
              <ActivityIndicator color={colors.warning} />
              {isDemo ? <Banner tone="demo" text={t('pay.demoPending')} /> : null}
            </View>
          ) : null}

          {shown === 'CASH' ? (
            <View style={styles.center} testID="pay-cash">
              <Art3D name="cash" size={132} float shadow />
              <Txt variant="title2" align="center" heading>{t('pay.cashTitle', { amount: formatRupees(amount) })}</Txt>
              <Txt variant="callout" color="inkMuted" align="center">{t('pay.cashBody', { name: b.technician ? l(b.technician.name) : '' })}</Txt>
              <ActivityIndicator color={colors.warning} />
            </View>
          ) : null}

          {shown === 'FAILED' ? (
            <View style={styles.center} testID="pay-failed">
              <Art3D name="card_failed" size={132} />
              <Txt variant="title2" align="center" heading>{t('pay.failed')}</Txt>
              <Txt variant="callout" color="inkMuted" align="center">{t('pay.failedBody')}</Txt>
              {isDemo ? <Banner tone="demo" text={t('pay.demoFailed')} /> : null}
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function Line({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.line}>
      <Txt variant="footnote" color="inkMuted" style={styles.flex}>{label}</Txt>
      <Txt variant="label">{value}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.md },
  skel: { height: 120, borderRadius: radius.lg },
  amountBox: { alignItems: 'center', gap: 2, paddingVertical: space.md },
  method: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  methodOn: { borderColor: colors.blue, backgroundColor: '#FBFCFF' },
  methodIcon: { width: 40, height: 40, borderRadius: radius.icon, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  secure: { flexDirection: 'row', alignItems: 'center', gap: space.xs, justifyContent: 'center' },
  center: { alignItems: 'center', gap: space.md, paddingTop: space.md },
  pulseBox: { width: 180, height: 180, alignItems: 'center', justifyContent: 'center' },
  receiptMini: { alignSelf: 'stretch', gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
