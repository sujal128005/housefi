// Payment (simulated): the ₹49 visit fee (?kind=VISIT) or the final bill (?kind=FINAL). Pick a method, pay, and see the
// outcome: paid, pending (confirms shortly), cash (the technician confirms) or failed (nothing taken). Every outcome is
// labelled as a demo. Coming from "Confirm & pay" (?auto=1) the chosen method is charged straight away.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { Booking, PaymentMethod } from '../domain/types';
import { Art3D } from '../illustrations/Art3D';
import { formatRupees } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { useBackend, useQuery } from '../services/ServicesProvider';
import { useSession } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { Banner, Button, Card, ErrorBanner, ErrorView, Header, Icon, RadioDot, Screen, Skeleton, Tap, Txt } from '../ui';
import { Appear, Pop, Pulse } from '../ui/motion';
import { PAY_METHODS } from '../ui/payMethods';
import { feedback } from '../services/feedback';

type Phase = 'CHOOSE' | 'PROCESSING' | 'PAID' | 'PENDING' | 'CASH' | 'FAILED';

function amountFor(b: Booking, kind: 'VISIT' | 'FINAL'): number {
  return kind === 'VISIT' ? b.visitPayment.amount : b.finalPayment?.amount ?? 0;
}

export default function Pay() {
  const params = useLocalSearchParams<{ id: string; kind?: string; method?: string; auto?: string }>();
  const kind: 'VISIT' | 'FINAL' = params.kind === 'FINAL' ? 'FINAL' : 'VISIT';
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const q = useQuery(() => backend.bookings.get(session.token, params.id), [backend, session.token, params.id]);
  const [method, setMethod] = useState<PaymentMethod>((params.method as PaymentMethod | undefined) ?? 'UPI');
  const [phase, setPhase] = useState<Phase>('CHOOSE');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<unknown>(null);
  const b = booking ?? q.data ?? null;
  const methods = kind === 'VISIT' ? PAY_METHODS.filter((m) => m.method !== 'CASH') : PAY_METHODS;

  // While pending (bank) or waiting for the technician to confirm cash, keep checking.
  useEffect(() => {
    if (phase !== 'PENDING' && phase !== 'CASH') return;
    const id = setInterval(() => {
      void backend.bookings.get(session.token, params.id).then((nb) => {
        setBooking(nb);
        const p = kind === 'VISIT' ? nb.visitPayment : nb.finalPayment;
        if (p?.state === 'PAID') {
          feedback(p.method === 'CASH' ? 'cash' : 'success');
          setPhase('PAID');
        }
      }).catch(() => undefined);
    }, 1500);
    return () => clearInterval(id);
  }, [phase, backend, session.token, params.id, kind]);

  const pay = async () => {
    feedback('pop');
    setPhase('PROCESSING');
    setError(null);
    try {
      const [r] = await Promise.all([backend.bookings.pay(session.token, params.id, kind, method), new Promise((res) => setTimeout(res, 1400))]);
      setBooking(r.booking);
      setPhase(r.state === 'PENDING' && method === 'CASH' ? 'CASH' : r.state);
      feedback(r.state === 'PAID' ? 'success' : r.state === 'FAILED' ? 'error' : 'notify');
    } catch (e) {
      feedback('error');
      setError(e);
      setPhase('CHOOSE');
    }
  };

  // Arriving from "Confirm & pay" with a method already chosen: pay at once instead of asking again.
  const autoStarted = useRef(false);
  const ready = !!b;
  useEffect(() => {
    if (params.auto !== '1' || autoStarted.current || !ready) return;
    autoStarted.current = true;
    void pay();
    // pay() only reads state that is fixed by the time the booking has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.auto, ready]);

  const done = () => {
    if (kind === 'VISIT') {
      if (router.canDismiss()) router.dismissAll();
      router.push({ pathname: '/book/confirmed', params: { id: params.id } });
    } else {
      router.replace({ pathname: '/booking/receipt', params: { id: params.id } });
    }
  };

  const amount = b ? amountFor(b, kind) : 0;
  const payment = b ? (kind === 'VISIT' ? b.visitPayment : b.finalPayment) : null;

  return (
    <Screen
      testID="pay"
      wash="lavender"
      header={<Header title={kind === 'VISIT' ? t('pay.titleVisit') : t('pay.titleFinal')} back={phase === 'CHOOSE' || phase === 'FAILED'} />}
      footer={
        phase === 'CHOOSE' ? <Button label={t('pay.cta', { amount: formatRupees(amount) })} icon="lock-closed" onPress={() => void pay()} disabled={!b} testID="pay-now" />
          : phase === 'PAID' ? <Button label={kind === 'VISIT' ? t('pay.continueVisit') : t('pay.viewReceipt')} trailingIcon="arrow-forward" onPress={done} testID="pay-continue" />
            : phase === 'PENDING' || phase === 'CASH' ? <Button label={t('pay.goToBooking')} variant="outline" onPress={() => {
              if (router.canDismiss()) router.dismissAll();
              router.push(`/booking/${params.id}`);
            }} testID="pay-go-booking" />
              : phase === 'FAILED' ? (
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

          {phase === 'CHOOSE' ? (
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
              <Banner tone="demo" text={t('pay.demo')} />
              <View style={styles.secure}><Icon name="shield-checkmark" size={16} color="success" /><Txt variant="footnote" color="inkMuted">{t('pay.secure')}</Txt></View>
            </Appear>
          ) : null}

          {phase === 'PROCESSING' ? (
            <View style={styles.center} testID="pay-processing">
              <View style={styles.pulseBox}>
                <Pulse size={170} color={colors.blue} />
                <Art3D name="card" size={110} float />
              </View>
              <ActivityIndicator color={colors.navy} />
              <Txt variant="title3" align="center">{t('pay.processing')}</Txt>
              <Txt variant="footnote" color="inkMuted" align="center">{t('pay.dontClose')}</Txt>
            </View>
          ) : null}

          {phase === 'PAID' ? (
            <View style={styles.center} testID="pay-success">
              <Pop><Art3D name="check" size={120} shadow /></Pop>
              <Art3D name="party" size={60} style={styles.party} />
              <Txt variant="title1" align="center" heading>{t('pay.success')}</Txt>
              <Txt variant="callout" color="inkMuted" align="center">{kind === 'VISIT' ? t('pay.successVisit') : t('pay.successFinal')}</Txt>
              <Card style={styles.receiptMini}>
                <Line label={t('pay.amount')} value={formatRupees(amount)} />
                <Line label={t('pay.method')} value={t(`pay.m.${payment?.method ?? method}`)} />
                {payment?.txnId ? <Line label={t('pay.txn')} value={payment.txnId} /> : null}
              </Card>
              <Banner tone="demo" text={t('pay.demoDone')} />
            </View>
          ) : null}

          {phase === 'PENDING' ? (
            <View style={styles.center} testID="pay-pending">
              <Art3D name="hourglass" size={110} float shadow />
              <Txt variant="title2" align="center" heading>{t('pay.pending')}</Txt>
              <Txt variant="callout" color="inkMuted" align="center">{t('pay.pendingBody')}</Txt>
              <ActivityIndicator color={colors.warning} />
              <Banner tone="demo" text={t('pay.demoPending')} />
            </View>
          ) : null}

          {phase === 'CASH' ? (
            <View style={styles.center} testID="pay-cash">
              <Art3D name="money" size={110} float shadow />
              <Txt variant="title2" align="center" heading>{t('pay.cashTitle', { amount: formatRupees(amount) })}</Txt>
              <Txt variant="callout" color="inkMuted" align="center">{t('pay.cashBody', { name: b.technician ? l(b.technician.name) : '' })}</Txt>
              <ActivityIndicator color={colors.warning} />
            </View>
          ) : null}

          {phase === 'FAILED' ? (
            <View style={styles.center} testID="pay-failed">
              <View>
                <Art3D name="card" size={110} />
                <View style={styles.failBadge}><Icon name="close" size={22} color="onNavy" /></View>
              </View>
              <Txt variant="title2" align="center" heading>{t('pay.failed')}</Txt>
              <Txt variant="callout" color="inkMuted" align="center">{t('pay.failedBody')}</Txt>
              <Banner tone="demo" text={t('pay.demoFailed')} />
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
  methodIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  secure: { flexDirection: 'row', alignItems: 'center', gap: space.xs, justifyContent: 'center' },
  center: { alignItems: 'center', gap: space.md, paddingTop: space.md },
  pulseBox: { width: 180, height: 180, alignItems: 'center', justifyContent: 'center' },
  party: { position: 'absolute', top: 0, right: '18%' },
  receiptMini: { alignSelf: 'stretch', gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  failBadge: { position: 'absolute', right: 0, bottom: 4, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.surface },
});
