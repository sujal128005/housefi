// Building blocks of the booking screens: progress stepper, technician card, arrival OTP, quote, bill, safety tools.
import { router } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { canCall, finalAmount, lineTotal, PROGRESS_STEPS, progressIndex } from '../domain/rules';
import type { AssignedTechnician, Booking, Quote } from '../domain/types';
import { Art3D } from '../illustrations/Art3D';
import { formatRupees } from '../i18n/format';
import { useI18n, type StringKey } from '../i18n/I18n';
import { colors, radius, shadow, space } from '../theme/tokens';
import { Button } from './Button';
import { Icon } from './Icon';
import { ConfirmSheet, Sheet, useToast } from './Overlays';
import { useMaskedCall } from './useMaskedCall';
import { useBackend } from '../services/ServicesProvider';
import { useSession } from '../state/AppState';
import { jobsText, visitTimeText } from './present';
import { Banner, Card, Divider, Pill } from './Surfaces';
import { Tap } from './Tap';
import { TechPhoto, VerificationPill } from './TechIdentity';
import { Txt } from './Txt';
import { feedback } from '../services/feedback';
import { dial } from '../services/calls';
import { quickPosition } from '../services/device';

const STEP_LABEL: Record<(typeof PROGRESS_STEPS)[number], StringKey> = {
  booked: 'progress.booked',
  assigned: 'progress.assigned',
  onTheWay: 'progress.onTheWay',
  repair: 'progress.repair',
  done: 'progress.done',
};

export function ProgressStepper({ booking }: { readonly booking: Booking }) {
  const { t } = useI18n();
  const at = progressIndex(booking.status);
  const stopped = booking.status === 'CANCELLED' || booking.status === 'UNFULFILLED';
  return (
    <View style={styles.stepper} accessibilityLabel={t(STEP_LABEL[PROGRESS_STEPS[at] ?? 'booked'])}>
      {PROGRESS_STEPS.map((s, i) => {
        const done = i < at || (i === at && booking.status === 'COMPLETED');
        const current = i === at && !done;
        return (
          <View key={s} style={styles.stepCol}>
            <View style={styles.stepRow}>
              {i > 0 ? <View style={[styles.stepLine, i <= at && !stopped && styles.stepLineOn]} /> : <View style={styles.stepLineSpace} />}
              <View style={[styles.stepDot, done && styles.stepDone, current && (stopped ? styles.stepStopped : styles.stepCurrent)]}>
                {done ? <Icon name="checkmark" size={12} color="onNavy" /> : null}
              </View>
              {i < PROGRESS_STEPS.length - 1 ? <View style={[styles.stepLine, i < at && !stopped && styles.stepLineOn]} /> : <View style={styles.stepLineSpace} />}
            </View>
            <Txt variant="caption" color={i <= at ? 'ink' : 'inkSubtle'} align="center" numberOfLines={2}>{t(STEP_LABEL[s])}</Txt>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The assigned technician: approved photo, name, rating, identity status. Tapping the photo, the name or "View
 * Technician ID" opens their digital ID card.
 */
export function TechnicianCard({ tech, booking }: { readonly tech: AssignedTechnician; readonly booking: Booking }) {
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const { calling, call } = useMaskedCall(session.token, booking.id, () => backend.bookings.call(session.token, booking.id));
  const openId = () => router.push({ pathname: '/booking/technician', params: { id: booking.id } });
  return (
    <Card style={styles.tech} testID="tech-card">
      <View style={styles.techRow}>
        <Tap onPress={openId} accessibilityRole="button" accessibilityLabel={`${l(tech.name)}, ${t('id.tapToView')}`} testID="tech-card-photo" scale={0.96}>
          <TechPhoto photo={tech.photo} gender={tech.gender} size={72} />
        </Tap>
        <View style={styles.flex}>
          <Txt variant="title3" onPress={openId} accessibilityRole="button" testID="tech-card-name">{l(tech.name)}</Txt>
          <View style={styles.meta}>
            <Icon name="star" size={14} color="yellow" />
            <Txt variant="label">{tech.rating > 0 ? tech.rating.toFixed(1) : t('track.newTech')}</Txt>
            <Txt variant="footnote" color="inkMuted">· {jobsText(tech.jobs, t)} · {t('track.experience', { years: tech.years })}</Txt>
          </View>
          <View style={styles.badges}>
            <VerificationPill state={tech.verification} simulated={tech.verificationSimulated} />
            {tech.womenRated ? <Pill label={t('track.womenRated')} tone="info" icon="heart" /> : null}
          </View>
        </View>
      </View>
      <Tap onPress={openId} style={styles.idLink} accessibilityRole="button" testID="tech-card-id">
        <Icon name="id-card" size={20} color="navy" />
        <View style={styles.flex}>
          <Txt variant="label" color="navy">{t('id.tapToView')}</Txt>
          {tech.techCode ? <Txt variant="caption" color="inkMuted" lang="en">{tech.techCode}</Txt> : null}
        </View>
        <Icon name="chevron-forward" size={18} color="inkMuted" />
      </Tap>
      {tech.vehicle ? (
        <View style={styles.vehicle}>
          <Art3D name="scooter" size={26} />
          <Txt variant="footnote" color="inkMuted">{tech.vehicle}</Txt>
        </View>
      ) : null}
      {booking.preferWomenRated && tech.womenRated ? <Banner tone="info" icon="heart" text={t('track.womenMatched')} /> : null}
      {canCall(booking.status) ? (
        <>
          <View style={styles.actions}>
            <Button label={t('track.call')} icon="call" variant="secondary" size="md" onPress={() => void call()} loading={calling} style={styles.flex} testID="tech-call" />
            <Button label={t('chat.open')} icon="chatbubbles" variant="secondary" size="md" onPress={() => router.push(`/chat/${booking.id}`)} style={styles.flex} testID="tech-chat" />
          </View>
          <Txt variant="caption" color="inkMuted" align="center">{t('track.masked')}</Txt>
        </>
      ) : null}
      {booking.demo ? <Banner tone="demo" text={t('track.demoBooking')} /> : null}
    </Card>
  );
}

/** The 4-digit code the customer tells the technician at the door; the visit starts only with it. */
export function ArrivalOtpCard({ code, highlight }: { readonly code: string; readonly highlight?: boolean }) {
  const { t } = useI18n();
  return (
    <View style={[styles.otp, highlight && styles.otpHot]} testID="arrival-otp" accessibilityLabel={`${t('otp.title')}: ${code.split('').join(' ')}`}>
      <View style={styles.otpHead}>
        <Art3D name="key" size={34} />
        <View style={styles.flex}>
          <Txt variant="bodyStrong" color={highlight ? 'onNavy' : 'ink'}>{t('otp.title')}</Txt>
          <Txt variant="footnote" color={highlight ? 'onNavy' : 'inkMuted'}>{highlight ? t('otp.now') : t('otp.later')}</Txt>
        </View>
      </View>
      <View style={styles.otpDigits}>
        {code.split('').map((d, i) => (
          <View key={i} style={[styles.otpDigit, highlight && styles.otpDigitHot]}>
            <Txt variant="title1" color={highlight ? 'navy' : 'ink'} testID={i === 0 ? 'arrival-otp-code' : undefined}>{d}</Txt>
          </View>
        ))}
      </View>
      <View style={styles.otpWarn}>
        <Icon name="shield-checkmark" size={16} color={highlight ? 'onNavy' : 'success'} />
        <Txt variant="caption" color={highlight ? 'onNavy' : 'inkMuted'} style={styles.flex}>{t('otp.warn')}</Txt>
      </View>
    </View>
  );
}

export function QuoteLines({ quote }: { readonly quote: Quote }) {
  const { l } = useI18n();
  return (
    <View style={styles.lines}>
      {quote.lines.map((ln, i) => (
        <View key={i} style={styles.line}>
          <View style={[styles.kind, ln.kind === 'LABOUR' ? styles.kindLabour : styles.kindMaterial]}>
            <Icon name={ln.kind === 'LABOUR' ? 'construct' : 'cube'} size={14} color={ln.kind === 'LABOUR' ? 'blue' : 'orange'} />
          </View>
          <Txt variant="callout" style={styles.flex}>{l(ln.name)}{ln.qty > 1 ? ` × ${ln.qty}` : ''}</Txt>
          <Txt variant="label">{formatRupees(lineTotal(ln))}</Txt>
        </View>
      ))}
    </View>
  );
}

/** Labour and material subtotals of a quote. */
export function QuoteSplit({ quote }: { readonly quote: Quote }) {
  const { t } = useI18n();
  return (
    <View style={styles.split}>
      <View style={styles.splitCell}>
        <Icon name="construct" size={16} color="blue" />
        <Txt variant="caption" color="inkMuted">{t('quote.labour')}</Txt>
        <Txt variant="bodyStrong" testID="quote-labour">{formatRupees(quote.labourTotal)}</Txt>
      </View>
      <View style={styles.splitCell}>
        <Icon name="cube" size={16} color="orange" />
        <Txt variant="caption" color="inkMuted">{t('quote.material')}</Txt>
        <Txt variant="bodyStrong" testID="quote-material">{formatRupees(quote.materialTotal)}</Txt>
      </View>
    </View>
  );
}

/** "AI price check" result shown on every quote the customer sees. */
export function PriceCheckPill({ quote }: { readonly quote: Quote }) {
  const { t } = useI18n();
  if (quote.review.state === 'CLEARED') return <Pill label={t('quote.checkCleared')} tone="info" icon="shield-checkmark" />;
  if (quote.review.state === 'FAIR') return <Pill label={t('quote.checkFair', { min: formatRupees(quote.review.typicalMin), max: formatRupees(quote.review.typicalMax) })} tone="success" icon="sparkles" />;
  return <Pill label={t('quote.checking')} tone="warning" icon="hourglass" />;
}

export function QuoteCard({ quote, title, onApprove, onReject, onRevision, busy, extra }: {
  readonly quote: Quote;
  readonly title: string;
  readonly onApprove?: () => void;
  readonly onReject?: () => void;
  /** Ask the technician for a lower price (main quote only). */
  readonly onRevision?: () => void;
  readonly busy?: boolean;
  readonly extra?: boolean;
}) {
  const { t, l } = useI18n();
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmRevision, setConfirmRevision] = useState(false);
  const waiting = quote.decision === 'REVISION_REQUESTED';
  return (
    <Card style={styles.quote} testID={extra ? 'extra-card' : 'quote-card'}>
      <View style={styles.quoteHead}>
        <Art3D name={extra ? 'memo' : 'clipboard'} size={44} />
        <View style={styles.flex}>
          <Txt variant="title3">{quote.version > 1 && !extra ? t('quote.revisedTitle') : title}</Txt>
          <Txt variant="footnote" color="inkMuted">{l(quote.diagnosis)}</Txt>
        </View>
      </View>
      <PriceCheckPill quote={quote} />
      <Divider />
      <QuoteLines quote={quote} />
      <QuoteSplit quote={quote} />
      <Divider />
      <View style={styles.line}>
        <Txt variant="bodyStrong" style={styles.flex}>{extra ? t('quote.extraTotal') : t('quote.total')}</Txt>
        <Txt variant="title2" testID={extra ? 'extra-total' : 'quote-total'}>{formatRupees(quote.total)}</Txt>
      </View>
      {!extra ? <Txt variant="caption" color="inkMuted">{t('quote.visitPaid')}</Txt> : null}
      {waiting ? <Banner tone="info" icon="hourglass" text={t('quote.revisionWaiting')} testID="quote-revision-waiting" /> : null}
      {onApprove && onReject && !waiting ? (
        <>
          <Button label={extra ? t('quote.approveExtra') : t('quote.approve')} icon="checkmark-circle" variant="success" onPress={onApprove} loading={busy} testID={extra ? 'extra-approve' : 'quote-approve'} />
          {onRevision ? <Button label={t('quote.askLower')} icon="pricetag-outline" variant="secondary" onPress={() => setConfirmRevision(true)} disabled={busy} testID="quote-revision" /> : null}
          <Button label={extra ? t('quote.rejectExtra') : t('quote.reject')} variant="outline" onPress={() => setConfirmReject(true)} disabled={busy} testID={extra ? 'extra-reject' : 'quote-reject'} />
          <ConfirmSheet visible={confirmReject} title={extra ? t('quote.rejectExtraTitle') : t('quote.rejectTitle')} body={extra ? t('quote.rejectExtraBody') : t('quote.rejectBody')}
            icon="close-circle" confirmLabel={extra ? t('quote.rejectExtra') : t('quote.reject')} confirmVariant="danger" cancelLabel={t('common.back')}
            onConfirm={() => {
              setConfirmReject(false);
              onReject();
            }} onCancel={() => setConfirmReject(false)} />
          {onRevision ? (
            <ConfirmSheet visible={confirmRevision} title={t('quote.askLowerTitle')} body={t('quote.askLowerBody')} icon="pricetag"
              confirmLabel={t('quote.askLower')} cancelLabel={t('common.back')}
              onConfirm={() => {
                setConfirmRevision(false);
                onRevision();
              }} onCancel={() => setConfirmRevision(false)} />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export function BillCard({ booking }: { readonly booking: Booking }) {
  const { t } = useI18n();
  const repair = finalAmount(booking.quote, booking.extraQuote);
  return (
    <Card style={styles.quote} testID="bill-card">
      <Txt variant="title3" heading>{t('bill.title')}</Txt>
      <View style={styles.line}>
        <Txt variant="callout" style={styles.flex}>{t('confirm.visitFee')}</Txt>
        <Txt variant="label" color="success">{t('bill.paid', { amount: formatRupees(booking.visitPayment.amount) })}</Txt>
      </View>
      {booking.quote?.decision === 'APPROVED' ? <QuoteLines quote={booking.quote} /> : null}
      {booking.extraQuote?.decision === 'APPROVED' ? <QuoteLines quote={booking.extraQuote} /> : null}
      <Divider />
      {booking.finalPayment?.method === 'CASH' && booking.finalPayment.state === 'PENDING' ? (
        <Banner tone="warning" icon="cash-outline" text={t('bill.cashPending', { amount: formatRupees(booking.finalPayment.amount) })} testID="bill-cash-pending" />
      ) : null}
      <View style={styles.line}>
        <Txt variant="bodyStrong" style={styles.flex}>{booking.status === 'COMPLETED' ? t('bill.totalPaid') : t('bill.toPay')}</Txt>
        <Txt variant="title2" testID="bill-total">{formatRupees(repair)}</Txt>
      </View>
    </Card>
  );
}

/** SOS and "share live status" while a visit is under way. */
export function SafetyRow({ booking }: { readonly booking: Booking }) {
  const { t, l, locale } = useI18n();
  const toast = useToast();
  const backend = useBackend();
  const session = useSession();
  const [sos, setSos] = useState(false);
  const [alerting, setAlerting] = useState(false);
  const call112 = async () => {
    setSos(false);
    if (!(await dial('112'))) toast.show(t('safety.dialFailed'), 'alert-circle');
  };
  const alertTeam = async () => {
    setAlerting(true);
    try {
      // Where the phone is goes with it when the phone gives it quickly; the alert never waits long for it.
      const where = await quickPosition();
      await backend.support.ticket(session.token, 'UNSAFE', booking.id, `SOS during visit ${booking.code}`, where);
      feedback('success');
      toast.show(t('safety.alerted'), 'shield-checkmark');
      setSos(false);
    } catch {
      toast.show(t('safety.alertFailed'), 'alert-circle');
    } finally {
      setAlerting(false);
    }
  };
  const share = async () => {
    const name = booking.technician ? l(booking.technician.name) : '';
    const msg = t('safety.shareText', { code: booking.code, name, when: visitTimeText(booking.time, locale, t) });
    try {
      await Share.share({ message: msg });
    } catch {
      toast.show(t('safety.shareFailed'), 'share-social');
    }
  };
  return (
    <View style={styles.safety}>
      <Tap onPress={() => {
        feedback('warning');
        setSos(true);
      }} style={[styles.safeBtn, styles.sosBtn]} accessibilityLabel={t('safety.sos')} testID="safety-sos" haptic>
        <Art3D name="sos" size={34} />
        <Txt variant="label" color="onDangerTint">{t('safety.sos')}</Txt>
      </Tap>
      <Tap onPress={() => void share()} style={styles.safeBtn} accessibilityLabel={t('safety.share')} testID="safety-share" haptic>
        <Art3D name="shield" size={34} />
        <Txt variant="label" color="onBlueTint">{t('safety.share')}</Txt>
      </Tap>
      <Sheet visible={sos} onClose={() => setSos(false)} testID="sos-sheet">
        <View style={styles.sosHead}>
          <Art3D name="sos" size={56} />
          <View style={styles.flex}>
            <Txt variant="title2" heading>{t('safety.sosTitle')}</Txt>
            <Txt variant="callout" color="inkMuted">{t('safety.sosBody')}</Txt>
          </View>
        </View>
        <Button label={t('safety.call112')} icon="call" variant="danger" onPress={() => void call112()} testID="sos-112" />
        <Button label={t('safety.alertTeam')} icon="notifications" loading={alerting} onPress={() => void alertTeam()} testID="sos-team" />
        <Button label={t('common.close')} variant="ghost" onPress={() => setSos(false)} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stepper: { flexDirection: 'row', paddingVertical: space.sm },
  stepCol: { flex: 1, alignItems: 'center', gap: space.xs },
  stepRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  stepLine: { flex: 1, height: 3, backgroundColor: colors.line },
  stepLineOn: { backgroundColor: colors.blue },
  stepLineSpace: { flex: 1 },
  stepDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  stepDone: { backgroundColor: colors.blue, borderColor: colors.blue },
  stepCurrent: { borderColor: colors.blue, borderWidth: 6 },
  stepStopped: { borderColor: colors.danger, borderWidth: 6 },
  tech: { gap: space.md, borderColor: colors.successTint, borderWidth: 2 },
  techRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginVertical: 2 },
  badges: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  idLink: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.blueTint },
  actions: { flexDirection: 'row', gap: space.sm },
  otp: { gap: space.md, padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.blueTint },
  otpHot: { backgroundColor: colors.navy, borderColor: colors.navy, ...shadow.raised },
  otpHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  otpDigits: { flexDirection: 'row', gap: space.sm, justifyContent: 'center' },
  otpDigit: { width: 58, height: 66, borderRadius: radius.md, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  otpDigitHot: { backgroundColor: colors.yellow },
  otpWarn: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  split: { flexDirection: 'row', gap: space.sm },
  splitCell: { flex: 1, gap: 2, padding: space.md, borderRadius: radius.md, backgroundColor: colors.canvas },
  quote: { gap: space.md },
  quoteHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lines: { gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kind: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  kindLabour: { backgroundColor: colors.blueTint },
  kindMaterial: { backgroundColor: '#FFF1E3' },
  safety: { flexDirection: 'row', gap: space.sm },
  safeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 56, borderRadius: radius.lg, backgroundColor: colors.blueTint },
  sosBtn: { backgroundColor: colors.dangerTint },
  sosHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
