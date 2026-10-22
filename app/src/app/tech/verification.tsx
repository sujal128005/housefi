// "Checking your details" after registration, like Apple's account recovery: the time the check is promised by (2 h by
// day, 4 h in the evening, a day at night; from the server) and what is being checked, ticking off as it is done. An
// approval shows only from that time (domain/techReview.ts), then "You're verified" and the way into the app. A
// request to correct something shows at once; rejected or suspended means no jobs. Until the Aadhaar card is
// verified (camera scan of its Secure QR), that is the next step here.
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { techStage } from '../../domain/techReview';
import { Art3D } from '../../illustrations/Art3D';
import { formatClock, formatDate, sameDay } from '../../i18n/format';
import { useI18n, type StringKey } from '../../i18n/I18n';
import { resetTo } from '../../navigation';
import { feedback } from '../../services/feedback';
import { useBackend } from '../../services/ServicesProvider';
import { useAppState, useTechSession } from '../../state/AppState';
import { useNow } from '../../state/useNow';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, Header, Icon, Screen, Txt } from '../../ui';
import { Celebrate, Pulse } from '../../ui/motion';
import { VerificationPill } from '../../ui/TechIdentity';

type Check = { readonly key: StringKey; readonly state: 'done' | 'warn' | 'wait' };

export default function Verification() {
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const { updateTech, setRole } = useAppState();
  const p = session.profile;
  const now = useNow(p.reviewBy);
  const stage = techStage(p, now);
  const ready = stage === 'READY';
  const simulated = p.identity?.simulated;
  // "You're verified" only for an explicit, real (not simulated) approval.
  const genuine = simulated === false;
  const last = useRef(stage);

  // While the decision is open, ask the server again every few seconds (an approval already given needs no asking).
  useEffect(() => {
    if (p.verification === 'APPROVED') return;
    let alive = true;
    const id = setInterval(() => {
      void backend.tech.me(session.token).then((next) => {
        if (alive) updateTech(next);
      }).catch(() => undefined);
    }, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [p.verification, backend, session.token, updateTech]);

  useEffect(() => {
    if (last.current === stage) return;
    last.current = stage;
    if (stage === 'READY') feedback('success');
    else if (stage === 'FIX') feedback('warning');
  }, [stage]);

  const aadhaar = p.aadhaar ?? null;
  const checks: readonly Check[] = [
    { key: 'tverify.c.details', state: 'done' },
    { key: 'tverify.c.aadhaar', state: aadhaar ? 'done' : 'wait' },
    { key: 'tverify.c.age', state: aadhaar ? 'done' : 'wait' },
    { key: 'tverify.c.name', state: aadhaar ? (aadhaar.nameMatches ? 'done' : 'warn') : 'wait' },
    { key: 'tverify.c.gender', state: aadhaar ? (aadhaar.genderMatches !== false ? 'done' : 'warn') : 'wait' },
    { key: 'tverify.c.photo', state: ready ? 'done' : 'wait' },
    { key: 'tverify.c.skills', state: ready ? 'done' : 'wait' },
  ];

  const due = p.reviewBy != null ? new Date(p.reviewBy) : null;
  const tomorrow = new Date(now + 86_400_000);
  const expected = !due ? null
    : now >= due.getTime() ? t('tverify.late')
      : sameDay(due, new Date(now)) ? t('tverify.byToday', { time: formatClock(due, locale) })
        : sameDay(due, tomorrow) ? t('tverify.byTomorrow', { time: formatClock(due, locale) })
          : t('tverify.byDate', { time: formatClock(due, locale), date: formatDate(due, locale) });

  const shownState = ready ? 'APPROVED' : stage === 'CHECKING' || stage === 'AADHAAR' ? 'PENDING' : p.verification;

  return (
    <Screen
      testID="tech-verification"
      wash={ready ? 'mint' : stage === 'FIX' || stage === 'STOPPED' ? 'peach' : 'sky'}
      header={<Header back={false} />}
      footer={ready ? <Button label={t('tverify.go')} trailingIcon="arrow-forward" onPress={() => resetTo('/tech/home')} testID="tverify-go" />
        : stage === 'FIX' ? <Button label={t('tverify.fix')} icon="create-outline" onPress={() => router.push({ pathname: '/tech/setup', params: { edit: '1' } })} testID="tverify-fix" />
          : <Button label={t('tverify.switch')} variant="outline" onPress={() => {
            setRole('CUSTOMER');
            resetTo('/');
          }} testID="tverify-switch" />}
    >
      <View style={styles.art} testID={`tverify-${shownState ?? 'NONE'}`}>
        {ready ? (
          <Celebrate size={150}><Art3D name="verify_ok" size={140} shadow /></Celebrate>
        ) : stage === 'FIX' || stage === 'STOPPED' ? <Art3D name="verify_fix" size={130} float shadow /> : (
          <>
            <Pulse size={200} color={colors.blue} />
            <Art3D name="verify_pending" size={120} float />
          </>
        )}
      </View>
      <Txt variant="title1" align="center" heading accessibilityLiveRegion="polite">
        {ready ? (genuine ? t('tverify.approved') : t('tverify.approvedDemo')) : stage === 'FIX' ? t('tverify.correction')
          : stage === 'STOPPED' ? t('tverify.stopped') : t('tverify.pending')}
      </Txt>
      <View style={styles.pill}><VerificationPill state={shownState} simulated={simulated} /></View>
      <Txt variant="body" color="inkMuted" align="center">
        {ready ? (genuine ? t('tverify.approvedBody') : t('tverify.approvedDemoBody')) : stage === 'FIX' ? t('tverify.correctionBody')
          : stage === 'STOPPED' ? t('tverify.stoppedBody') : t('tverify.pendingBody')}
      </Txt>
      {(stage === 'CHECKING' || stage === 'AADHAAR') && expected ? (
        <Card style={styles.due} testID="tverify-due">
          <Icon name="time-outline" size={22} color="navy" />
          <Txt variant="bodyStrong" style={styles.flex}>{expected}</Txt>
        </Card>
      ) : null}
      {stage === 'FIX' && p.correctionNote ? <Banner tone="warning" icon="alert-circle" text={l(p.correctionNote)} /> : null}
      {stage === 'AADHAAR' ? (
        <Card style={styles.aadhaar} testID="tverify-aadhaar">
          <View style={styles.step}>
            <Art3D name="shield" size={44} />
            <View style={styles.flex}>
              <Txt variant="bodyStrong">{t('aadhaar.cardTitle')}</Txt>
              <Txt variant="footnote" color="inkMuted">{t('aadhaar.cardBody')}</Txt>
            </View>
          </View>
          <Button label={t('aadhaar.scan')} icon="qr-code" size="md" onPress={() => router.push('/tech/aadhaar')} testID="tverify-aadhaar-scan" />
        </Card>
      ) : null}
      {stage !== 'STOPPED' ? (
        <Card style={styles.steps} testID="tverify-checks">
          <Txt variant="label" color="inkMuted">{t('tverify.whatTitle')}</Txt>
          {checks.map((c) => (
            <View key={c.key} style={styles.step} testID={`tverify-check-${c.key.slice('tverify.c.'.length)}-${c.state}`}>
              <View style={[styles.dot, c.state === 'done' && styles.dotDone, c.state === 'warn' && styles.dotWarn]}>
                {c.state === 'done' ? <Icon name="checkmark" size={14} color="onNavy" /> : c.state === 'warn' ? <Icon name="alert" size={14} color="onNavy" /> : null}
              </View>
              <Txt variant="callout" color={c.state === 'wait' ? 'inkMuted' : 'ink'} style={styles.flex}>{t(c.key)}</Txt>
            </View>
          ))}
        </Card>
      ) : null}
      {aadhaar && !aadhaar.nameMatches && !ready ? <Banner tone="warning" icon="card" testID="tverify-aadhaar-done" text={t('aadhaar.nameDiffers')} /> : null}
      {aadhaar && aadhaar.genderMatches === false && !ready ? (
        <Banner tone="warning" icon="person" testID="tverify-gender" text={t('aadhaar.genderDiffers')} action={t('tprofile.edit')} onAction={() => router.push({ pathname: '/tech/setup', params: { edit: '1' } })} />
      ) : null}
      {/* Verified automatically (no person in between) once the checks pass: the window cannot be shortened. */}
      {stage === 'CHECKING' && (!aadhaar || (aadhaar.nameMatches && aadhaar.genderMatches !== false)) ? <Banner tone="info" icon="time-outline" text={t('tverify.autoNote')} testID="tverify-auto-note" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  art: { alignItems: 'center', justifyContent: 'center', height: 210 },
  pill: { flexDirection: 'row', justifyContent: 'center' },
  due: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  steps: { gap: space.md },
  aadhaar: { gap: space.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success, borderRadius: radius.pill },
  dotWarn: { backgroundColor: colors.warning, borderColor: colors.warning, borderRadius: radius.pill },
});
