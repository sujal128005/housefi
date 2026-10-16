// One job, one action at a time: Start trip -> I've arrived -> enter the customer's code -> prepare the quote -> wait
// for approval (or revise) -> start repair -> (extra materials) -> complete -> collect payment -> summary.
// Customer details, directions, a masked call and "report a problem" are always at hand.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { categoryById, serviceById } from '../../../data/catalog';
import { DEMO_TIMING, isActive, START_CODE_ATTEMPTS } from '../../../domain/rules';
import { quoteVisible, type Job, type TechIssue } from '../../../domain/types';
import { Art3D, serviceArt, type ArtName } from '../../../illustrations/Art3D';
import { TrackingMap } from '../../../illustrations/TrackingMap';
import { formatRupees } from '../../../i18n/format';
import { useI18n, type StringKey } from '../../../i18n/I18n';
import { isApiError } from '../../../services/api';
import { feedback } from '../../../services/feedback';
import { useBackend } from '../../../services/ServicesProvider';
import { useTechSession } from '../../../state/AppState';
import { colors, GUTTER, radius, shadow, space } from '../../../theme/tokens';
import {
  Banner, Button, Card, ConfirmSheet, Divider, ErrorBanner, ErrorView, Field, Header, Icon, NotInDemoSheet, Pill, Screen, Sheet, Skeleton, Tap, Txt, useToast,
  type IconName,
} from '../../../ui';
import { PriceCheckPill, QuoteLines, QuoteSplit } from '../../../ui/BookingParts';
import { Pop, Pulse, RideIn, useReducedMotion } from '../../../ui/motion';
import { PhotoThumb } from '../../../ui/PhotoThumb';
import { addressLine, visitTimeText } from '../../../ui/present';
import { InfoRow, MoneyRow, openDirections, TechStepper } from '../../../ui/TechParts';

const ISSUES: readonly { issue: TechIssue; icon: IconName }[] = [
  { issue: 'CUSTOMER_UNAVAILABLE', icon: 'person-remove-outline' },
  { issue: 'WRONG_ADDRESS', icon: 'location-outline' },
  { issue: 'CANNOT_COMPLETE', icon: 'construct-outline' },
  { issue: 'UNSAFE', icon: 'warning-outline' },
  { issue: 'PAYMENT_PROBLEM', icon: 'card-outline' },
  { issue: 'OTHER', icon: 'chatbubble-ellipses-outline' },
];

function issueAllowed(issue: TechIssue, j: Job): boolean {
  if (issue === 'CUSTOMER_UNAVAILABLE') return j.status === 'ARRIVED';
  if (issue === 'CANNOT_COMPLETE') return ['INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS'].includes(j.status);
  return isActive(j.status);
}

export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [code, setCode] = useState('');
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [report, setReport] = useState(false);
  const [issue, setIssue] = useState<TechIssue | null>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<'COMPLETE' | 'CASH' | 'REPORT' | null>(null);
  const [call, setCall] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const codeInput = useRef<TextInput>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    setLoadError(null);
    return backend.tech.watchJob(session.token, id, (j) => {
      setJob(j);
      setLoadError(null);
    }, (e) => setLoadError(e));
  }, [backend, session.token, id, attempt]);

  // Sound and vibration when the customer answers or pays while this screen is open.
  const sig = job ? `${job.status}|${job.quote?.decision}|${job.quote?.review.state}|${job.extraQuote?.decision}|${job.finalPayment?.state}` : '';
  const lastSig = useRef(sig);
  useEffect(() => {
    const prev = lastSig.current;
    lastSig.current = sig;
    if (!prev || !job || prev === sig) return;
    if (job.status === 'COMPLETED') feedback('cash');
    else if (job.status === 'IN_PROGRESS' && prev.startsWith('QUOTE_SHARED')) feedback('success');
    else if (job.quote?.decision === 'REVISION_REQUESTED' || job.status === 'CLOSED_NO_REPAIR' || job.status === 'CANCELLED') feedback('warning');
    else if (job.status === 'QUOTE_SHARED' || job.status === 'EXTRA_WORK') feedback('notify');
  }, [sig, job]);

  const travelling = job?.status === 'EN_ROUTE';
  useEffect(() => {
    if (!travelling) return;
    const timer = setInterval(() => setNow(Date.now()), reduce ? 5000 : 1000);
    return () => clearInterval(timer);
  }, [travelling, reduce]);

  if (!job) {
    return (
      <Screen header={<Header title={t('tj.title')} />} testID="tech-job">
        {loadError ? <ErrorView error={loadError} onRetry={() => setAttempt((a) => a + 1)} /> : <><Skeleton style={styles.skelHero} /><Skeleton style={styles.skelCard} /></>}
      </Screen>
    );
  }

  const j = job;
  const svc = serviceById(j.serviceId);
  const cat = categoryById(j.categoryId);
  const issues = svc ? svc.issues.filter((x) => j.problem.issueIds.includes(x.id)).map((x) => l(x.name)) : [];
  const enRouteAt = [...j.history].reverse().find((h) => h.status === 'EN_ROUTE')?.at ?? now;
  const travelProgress = Math.min(0.95, (now - enRouteAt) / 1000 / DEMO_TIMING.travelSec);
  const cashPending = j.status === 'PAYMENT_DUE' && j.finalPayment?.method === 'CASH' && j.finalPayment.state === 'PENDING';
  const live = isActive(j.status);

  const act = async (f: () => Promise<Job>, cue: Parameters<typeof feedback>[0] = 'success', okMsg?: string) => {
    setBusy(true);
    setError(null);
    try {
      setJob(await f());
      feedback(cue);
      if (okMsg) toast.show(okMsg, 'checkmark-circle');
    } catch (e) {
      feedback('error');
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const directions = async () => {
    const ok = await openDirections(j.address);
    if (!ok) toast.show(t('tj.mapsFailed'), 'map');
  };


  const verify = async (value: string) => {
    if (value.length !== 4 || busy || locked) return;
    setBusy(true);
    setCodeProblem(null);
    try {
      setJob(await backend.tech.verifyStartCode(session.token, j.id, value));
      feedback('success');
      toast.show(t('tj.codeOk'), 'checkmark-circle');
    } catch (e) {
      setCode('');
      feedback('error');
      if (isApiError(e, 'OTP_INVALID')) setCodeProblem(t('tj.codeWrong', { left: e.attemptsLeft ?? 0 }));
      else if (isApiError(e, 'OTP_LOCKED')) {
        setLocked(true);
        setCodeProblem(t('tj.codeLocked'));
      } else setError(e);
    } finally {
      setBusy(false);
    }
  };

  const peekCode = async () => {
    if (!backend.demo) return;
    const c = await backend.demo.startCode(session.token, j.id).catch(() => null);
    if (c) {
      setCode(c);
      void verify(c);
    }
  };

  const sendReport = async () => {
    if (!issue) return;
    const closes = issue === 'CUSTOMER_UNAVAILABLE' || issue === 'CANNOT_COMPLETE';
    setConfirm(null);
    setReport(false);
    await act(() => backend.tech.report(session.token, j.id, issue, note.trim()), closes ? 'warning' : 'send', closes ? undefined : t('tj.reported'));
    setIssue(null);
    setNote('');
  };

  const stage = stageOf(j);

  return (
    <Screen
      testID="tech-job"
      wash={stage.wash}
      header={<Header title={`${t('tj.title')} · ${j.code}`} />}
      footer={<Footer />}
    >
      <TechStepper status={j.status} />

      {/* the stage: art, title, one line of guidance */}
      <View style={styles.hero} testID={`tj-${j.status}`}>
        {j.status === 'ASSIGNED' ? (
          <View style={styles.ride}><RideIn distance={width}><Art3D name="scooter" size={130} shadow /></RideIn></View>
        ) : j.status === 'EN_ROUTE' ? (
          <View style={styles.stack}>
            <View style={styles.map}><TrackingMap progress={travelProgress} width={width - GUTTER * 2} /></View>
            <Button label={t('tj.openDirections')} icon="navigate" variant="secondary" onPress={() => void directions()} testID="tj-directions" />
          </View>
        ) : stage.pulse ? (
          <View style={styles.art}><Pulse size={170} color={colors.blue} /><Art3D name={stage.art} size={104} float /></View>
        ) : j.status === 'COMPLETED' ? (
          <View style={styles.art}><Pop><Art3D name="trophy" size={120} shadow /></Pop></View>
        ) : (
          <View style={styles.art}><Art3D name={stage.art} size={110} float={live} shadow /></View>
        )}
        <Txt variant="title2" align="center" heading accessibilityLiveRegion="polite" testID="tj-title">{t(stage.title, { name: j.customerName, amount: formatRupees(j.finalPayment?.amount ?? j.quote?.total ?? 0) })}</Txt>
        <Txt variant="callout" color="inkMuted" align="center">{t(stage.body, { name: j.customerName, amount: formatRupees(j.finalPayment?.amount ?? j.quote?.total ?? 0), earn: formatRupees(j.earning) })}</Txt>
        {j.practice ? <View style={styles.center}><Pill label={t('tech.practiceLong')} tone="demo" icon="school" /></View> : null}
      </View>

      {/* start code */}
      {j.status === 'ARRIVED' ? (
        <Card style={styles.codeCard}>
          <Tap onPress={() => codeInput.current?.focus()} scale={1} accessibilityLabel={t('tj.codeLabel')} testID="tj-code-boxes">
            <View style={styles.boxes}>
              {[0, 1, 2, 3].map((k) => (
                <View key={k} style={[styles.box, code.length === k && !locked && styles.boxActive, !!codeProblem && styles.boxError]}>
                  <Txt variant="title1" align="center">{code[k] ?? ''}</Txt>
                </View>
              ))}
            </View>
          </Tap>
          <TextInput ref={codeInput} value={code} testID="tj-code-input" keyboardType="number-pad" maxLength={4} editable={!locked} autoFocus style={styles.hidden}
            accessibilityLabel={t('tj.codeLabel')}
            onChangeText={(v) => {
              const d = v.replace(/\D/g, '').slice(0, 4);
              setCode(d);
              setCodeProblem(null);
              if (d.length === 4) void verify(d);
            }} />
          <Txt variant="caption" color="inkMuted" align="center">{t('tj.codeHint', { n: j.otpAttemptsLeft || START_CODE_ATTEMPTS })}</Txt>
          {codeProblem ? <Banner tone="danger" text={codeProblem} testID="tj-code-problem" /> : null}
          {backend.demo ? (
            <Tap onPress={() => void peekCode()} style={styles.demoLink} accessibilityLabel={t('tj.demoCode')} testID="tj-demo-code">
              <Icon name="flask" size={16} color="demo" />
              <Txt variant="label" color="demo">{t('tj.demoCode')}</Txt>
            </Tap>
          ) : null}
        </Card>
      ) : null}

      {/* quote state */}
      {j.quote && ['INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK', 'PAYMENT_DUE', 'COMPLETED'].includes(j.status) ? (
        <Card style={styles.quote} testID="tj-quote">
          <View style={styles.rowBetween}>
            <Txt variant="title3" heading>{j.quote.version > 1 ? t('quote.revisedTitle') : t('quote.title')}</Txt>
            <Txt variant="title2">{formatRupees(j.quote.total)}</Txt>
          </View>
          <PriceCheckPill quote={j.quote} />
          {j.quote.review.state === 'UNDER_REVIEW' ? <Banner tone="warning" icon="hourglass" text={t('tj.underReview', { min: formatRupees(j.quote.review.typicalMin), max: formatRupees(j.quote.review.typicalMax) })} /> : null}
          <QuoteSplit quote={j.quote} />
          {quoteVisible(j.quote) ? <Pill label={t(`tj.decision.${j.quote.decision}`)} tone={j.quote.decision === 'APPROVED' ? 'success' : j.quote.decision === 'PENDING' ? 'info' : 'warning'} /> : null}
        </Card>
      ) : null}
      {j.extraQuote ? (
        <Card style={styles.quote} testID="tj-extra">
          <View style={styles.rowBetween}>
            <Txt variant="title3" heading>{t('quote.extraTitle')}</Txt>
            <Txt variant="title2">{formatRupees(j.extraQuote.total)}</Txt>
          </View>
          <PriceCheckPill quote={j.extraQuote} />
          <QuoteLines quote={j.extraQuote} />
          {quoteVisible(j.extraQuote) ? <Pill label={t(`tj.decision.${j.extraQuote.decision}`)} tone={j.extraQuote.decision === 'APPROVED' ? 'success' : j.extraQuote.decision === 'PENDING' ? 'info' : 'warning'} /> : null}
        </Card>
      ) : null}

      {/* payment / summary */}
      {['PAYMENT_DUE', 'COMPLETED', 'CLOSED_NO_REPAIR', 'CANCELLED'].includes(j.status) ? (
        <Card style={styles.quote} testID="tj-summary">
          <Txt variant="title3" heading>{j.status === 'PAYMENT_DUE' ? t('tj.payment') : t('tj.summary')}</Txt>
          <MoneyRow label={t('confirm.visitFee')} value={j.visitPayment.amount} />
          {j.finalPayment ? <MoneyRow label={t('confirm.repair')} value={j.finalPayment.amount} /> : null}
          {j.finalPayment ? (
            <View style={styles.rowBetween}>
              <Txt variant="callout" color="inkMuted">{t('pay.method')}</Txt>
              <Pill label={`${j.finalPayment.method ? t(`pay.m.${j.finalPayment.method}`) : '—'} · ${t(`pay.state.${j.finalPayment.state}`)}`}
                tone={j.finalPayment.state === 'PAID' ? 'success' : j.finalPayment.state === 'FAILED' ? 'danger' : 'warning'} />
            </View>
          ) : null}
          <Divider />
          <MoneyRow label={j.status === 'COMPLETED' || j.status === 'CLOSED_NO_REPAIR' || j.status === 'CANCELLED' ? t('tj.youEarned') : t('tj.youWillEarn')} value={j.earning} strong tone="success" />
          {j.status !== 'PAYMENT_DUE' ? <Txt variant="caption" color="inkMuted">{t('tj.payoutNote')}</Txt> : null}
          {j.rating ? <Banner tone={j.rating.satisfied ? 'success' : 'warning'} icon="star" text={t('tj.rated', { stars: j.rating.stars })} /> : null}
        </Card>
      ) : null}

      <ErrorBanner error={error} />

      {/* the customer and the job */}
      <Card style={styles.details} testID="tj-details">
        <View style={styles.rowBetween}>
          <View style={styles.row}>
            {cat ? <Art3D name={serviceArt(j.serviceId, cat.art)} size={40} /> : null}
            <View>
              <Txt variant="bodyStrong">{svc ? l(svc.name) : j.serviceId}</Txt>
              <Txt variant="footnote" color="inkMuted">{visitTimeText(j.time, locale, t)}</Txt>
            </View>
          </View>
        </View>
        {issues.length > 0 ? <View style={styles.chips}>{issues.map((x) => <Pill key={x} label={x} tone="info" icon="construct" />)}</View> : null}
        {j.problem.notes ? <Txt variant="callout">“{j.problem.notes}”</Txt> : null}
        {j.problem.voiceNote ? (
          <View style={styles.voice}>
            <Icon name="mic" size={16} color="demo" />
            <Txt variant="footnote" style={styles.flex}>{j.problem.voiceNote.transcript}</Txt>
          </View>
        ) : null}
        {j.problem.photos.length > 0 ? <View style={styles.chips}>{j.problem.photos.map((p) => <PhotoThumb key={p.id} photo={p} size={64} />)}</View> : null}
        <Divider />
        <InfoRow icon="person" label={t('tj.customer')} value={j.customerName} />
        <InfoRow icon="location" label={t('tj.address')} value={`${addressLine(j.address)}, ${j.address.city} ${j.address.pincode}`} />
        {live ? (
          <View style={styles.actions}>
            <Button label={t('tj.navigate')} icon="navigate" variant="secondary" size="md" onPress={() => void directions()} style={styles.flex} testID="tj-navigate" />
            <Button label={t('track.call')} icon="call" variant="secondary" size="md" onPress={() => setCall(true)} style={styles.flex} testID="tj-call" />
          </View>
        ) : null}
        {live ? <Txt variant="caption" color="inkMuted" align="center">{t('tj.masked')}</Txt> : null}
      </Card>

      {live ? (
        <Tap onPress={() => setReport(true)} style={styles.help} accessibilityLabel={t('tj.report')} testID="tj-report">
          <Art3D name="sos" size={36} />
          <View style={styles.flex}>
            <Txt variant="bodyStrong">{t('tj.report')}</Txt>
            <Txt variant="footnote" color="inkMuted">{t('tj.reportSub')}</Txt>
          </View>
          <Icon name="chevron-forward" size={18} color="inkSubtle" />
        </Tap>
      ) : null}

      <Sheet visible={report} onClose={() => setReport(false)} testID="tj-report-sheet">
        <Txt variant="title2" heading>{t('tj.report')}</Txt>
        {ISSUES.map((x) => {
          const allowed = issueAllowed(x.issue, j);
          return (
            <Tap key={x.issue} onPress={() => setIssue(x.issue)} disabled={!allowed} style={[styles.issue, issue === x.issue && styles.issueOn, !allowed && styles.issueOff]}
              accessibilityRole="radio" accessibilityState={{ selected: issue === x.issue, disabled: !allowed }} accessibilityLabel={t(`tj.issue.${x.issue}`)} testID={`tj-issue-${x.issue}`}>
              <Icon name={x.icon} size={20} color={x.issue === 'UNSAFE' ? 'danger' : 'navy'} />
              <View style={styles.flex}>
                <Txt variant="bodyStrong">{t(`tj.issue.${x.issue}`)}</Txt>
                <Txt variant="footnote" color="inkMuted">{t(`tj.issueSub.${x.issue}`)}</Txt>
              </View>
            </Tap>
          );
        })}
        {issue ? <Field label={t('tj.note')} optional value={note} onChangeText={setNote} maxLength={300} multiline testID="tj-report-note" /> : null}
        <Button label={t('tj.send')} icon="send" variant={issue === 'UNSAFE' ? 'danger' : 'primary'} disabled={!issue} onPress={() => {
          if (issue === 'CUSTOMER_UNAVAILABLE' || issue === 'CANNOT_COMPLETE') setConfirm('REPORT');
          else void sendReport();
        }} testID="tj-report-send" />
        {issue === 'UNSAFE' ? <Banner tone="danger" text={t('tj.unsafe')} /> : null}
        <Banner tone="demo" text={t('safety.demo')} />
      </Sheet>

      <ConfirmSheet visible={confirm === 'REPORT'} title={t('tj.closeTitle')} body={t('tj.closeBody')} icon="close-circle" confirmLabel={t('tj.closeConfirm')} confirmVariant="danger"
        cancelLabel={t('common.back')} onConfirm={() => void sendReport()} onCancel={() => setConfirm(null)} busy={busy} />
      <ConfirmSheet visible={confirm === 'COMPLETE'} title={t('tj.completeTitle')} body={t('tj.completeBody')} icon="checkmark-circle" confirmLabel={t('tj.complete')}
        cancelLabel={t('common.back')} onConfirm={() => {
          setConfirm(null);
          void act(() => backend.tech.completeWork(session.token, j.id), 'success');
        }} onCancel={() => setConfirm(null)} busy={busy} />
      <ConfirmSheet visible={confirm === 'CASH'} title={t('tj.cashTitle', { amount: formatRupees(j.finalPayment?.amount ?? 0) })} body={t('tj.cashBody')} icon="cash" confirmLabel={t('tj.cashConfirm')}
        cancelLabel={t('common.back')} onConfirm={() => {
          setConfirm(null);
          void act(() => backend.tech.confirmCash(session.token, j.id), 'cash');
        }} onCancel={() => setConfirm(null)} busy={busy} />
      <NotInDemoSheet visible={call} title={t('track.call')} onClose={() => setCall(false)} />
    </Screen>
  );

  /** The one main button for the current stage. */
  function Footer() {
    switch (j.status) {
      case 'ASSIGNED':
        return <Button label={t('tj.startTrip')} icon="navigate" onPress={() => void act(() => backend.tech.startTrip(session.token, j.id), 'pop')} loading={busy} testID="tj-start-trip" />;
      case 'EN_ROUTE':
        return <Button label={t('tj.arrived')} icon="flag" onPress={() => void act(() => backend.tech.arrived(session.token, j.id), 'notify')} loading={busy} testID="tj-arrived" />;
      case 'ARRIVED':
        return <Button label={t('tj.startJob')} icon="key" onPress={() => void verify(code)} disabled={code.length !== 4 || locked} loading={busy} testID="tj-verify" />;
      case 'INSPECTING':
        return j.quote ? <Button label={t('tj.checking')} variant="secondary" onPress={() => undefined} disabled testID="tj-checking" />
          : <Button label={t('tj.prepareQuote')} icon="calculator" onPress={() => router.push({ pathname: '/tech/quote/[id]', params: { id: j.id, which: 'MAIN' } })} testID="tj-prepare-quote" />;
      case 'QUOTE_SHARED':
        return j.quote?.decision === 'REVISION_REQUESTED'
          ? <Button label={t('tj.revise')} icon="create" onPress={() => router.push({ pathname: '/tech/quote/[id]', params: { id: j.id, which: 'MAIN' } })} testID="tj-revise" />
          : <Button label={t('tj.waiting')} variant="secondary" onPress={() => undefined} disabled testID="tj-waiting" />;
      case 'IN_PROGRESS':
        if (!j.workStarted) return <Button label={t('tj.startWork')} icon="play" variant="success" onPress={() => void act(() => backend.tech.startWork(session.token, j.id), 'pop')} loading={busy} testID="tj-start-work" />;
        return (
          <View style={styles.footerCol}>
            {!j.extraQuote ? <Button label={t('tj.extra')} icon="add-circle-outline" variant="outline" size="md" onPress={() => router.push({ pathname: '/tech/quote/[id]', params: { id: j.id, which: 'EXTRA' } })} testID="tj-extra-btn" /> : null}
            <Button label={t('tj.complete')} icon="checkmark-done" variant="success" disabled={j.extraQuote?.decision === 'PENDING'} onPress={() => setConfirm('COMPLETE')} testID="tj-complete" />
          </View>
        );
      case 'EXTRA_WORK':
        return <Button label={t('tj.waitingExtra')} variant="secondary" onPress={() => undefined} disabled testID="tj-waiting-extra" />;
      case 'PAYMENT_DUE':
        return cashPending
          ? <Button label={t('tj.cashReceived', { amount: formatRupees(j.finalPayment?.amount ?? 0) })} icon="cash" variant="success" onPress={() => setConfirm('CASH')} testID="tj-cash" />
          : <Button label={t('tj.waitingPay')} variant="secondary" onPress={() => undefined} disabled testID="tj-waiting-pay" />;
      default:
        return <Button label={t('tj.backHome')} trailingIcon="arrow-forward" onPress={() => router.replace('/tech/home')} testID="tj-home" />;
    }
  }
}

interface Stage {
  readonly art: ArtName;
  readonly title: StringKey;
  readonly body: StringKey;
  readonly wash: 'sky' | 'mint' | 'peach' | 'lavender' | 'sunrise';
  readonly pulse?: boolean;
}

function stageOf(j: Job): Stage {
  switch (j.status) {
    case 'ASSIGNED': return { art: 'scooter', title: 'tj.s.assigned', body: 'tj.s.assignedBody', wash: 'sky' };
    case 'EN_ROUTE': return { art: 'scooter', title: 'tj.s.enroute', body: 'tj.s.enrouteBody', wash: 'sky' };
    case 'ARRIVED': return { art: 'start_code', title: 'tj.s.arrived', body: 'tj.s.arrivedBody', wash: 'lavender' };
    case 'INSPECTING':
      if (!j.quote) return { art: 'inspecting', title: 'tj.s.inspect', body: 'tj.s.inspectBody', wash: 'lavender' };
      return j.quote.review.state === 'UNDER_REVIEW'
        ? { art: 'hourglass', title: 'tj.s.review', body: 'tj.s.reviewBody', wash: 'peach', pulse: true }
        : { art: 'robot', title: 'tj.s.checking', body: 'tj.s.checkingBody', wash: 'lavender', pulse: true };
    case 'QUOTE_SHARED':
      return j.quote?.decision === 'REVISION_REQUESTED'
        ? { art: 'memo', title: 'tj.s.revision', body: 'tj.s.revisionBody', wash: 'peach' }
        : { art: 'hourglass', title: 'tj.s.waitApproval', body: 'tj.s.waitApprovalBody', wash: 'sky', pulse: true };
    case 'IN_PROGRESS':
      if (!j.workStarted) return { art: 'thumbs_up', title: 'tj.s.approved', body: 'tj.s.approvedBody', wash: 'mint' };
      if (j.extraQuote?.decision === 'PENDING') return { art: 'robot', title: 'tj.s.extraChecking', body: 'tj.s.checkingBody', wash: 'lavender', pulse: true };
      return { art: 'tools', title: 'tj.s.working', body: 'tj.s.workingBody', wash: 'mint' };
    case 'EXTRA_WORK': return { art: 'hourglass', title: 'tj.s.waitExtra', body: 'tj.s.waitExtraBody', wash: 'sky', pulse: true };
    case 'PAYMENT_DUE':
      if (j.finalPayment?.method === 'CASH' && j.finalPayment.state === 'PENDING') return { art: 'cash', title: 'tj.s.cash', body: 'tj.s.cashBody', wash: 'sunrise' };
      if (j.finalPayment?.state === 'FAILED') return { art: 'card_failed', title: 'tj.s.payFailed', body: 'tj.s.payFailedBody', wash: 'peach' };
      return { art: 'pay_due', title: 'tj.s.waitPay', body: 'tj.s.waitPayBody', wash: 'sky', pulse: true };
    case 'COMPLETED': return { art: 'trophy', title: 'tj.s.done', body: 'tj.s.doneBody', wash: 'mint' };
    case 'CLOSED_NO_REPAIR':
      return { art: 'package', title: 'tj.s.closed', body: j.closeReason === 'CUSTOMER_DECLINED' ? 'tj.s.closedDeclined' : j.closeReason === 'CUSTOMER_UNAVAILABLE' ? 'tj.s.closedUnavailable' : 'tj.s.closedCannot', wash: 'sky' };
    case 'CANCELLED': return { art: 'package', title: 'tj.s.cancelled', body: 'tj.s.cancelledBody', wash: 'sky' };
    default: return { art: 'clipboard', title: 'tj.s.inspect', body: 'tj.s.inspectBody', wash: 'sky' };
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  skelHero: { height: 240, borderRadius: radius.xxl },
  skelCard: { height: 180, borderRadius: radius.lg },
  hero: { gap: space.sm },
  art: { alignItems: 'center', justifyContent: 'center', minHeight: 150 },
  ride: { height: 160, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  map: { borderRadius: radius.xl, overflow: 'hidden' },
  stack: { gap: space.sm },
  codeCard: { gap: space.md },
  boxes: { flexDirection: 'row', gap: space.md, justifyContent: 'center' },
  box: { width: 62, height: 72, borderRadius: radius.md, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  boxActive: { borderColor: colors.blue },
  boxError: { borderColor: colors.danger },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  demoLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.demo },
  quote: { gap: space.md },
  details: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  voice: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.demoTint },
  actions: { flexDirection: 'row', gap: space.sm },
  help: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 68, paddingHorizontal: space.md, borderRadius: radius.lg, backgroundColor: colors.dangerTint, ...shadow.card },
  issue: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line },
  issueOn: { borderColor: colors.blue, backgroundColor: colors.blueTint },
  issueOff: { opacity: 0.4 },
  footerCol: { gap: space.sm },
});

