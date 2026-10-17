// Verification status after submitting the profile: Pending (checking), Approved (go to home), Needs correction
// (with what to fix), or Rejected / Suspended (no jobs; contact support). Checks again every few seconds. An approval
// made by the demo backend is called a demo approval, never "verified".
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n } from '../../i18n/I18n';
import { resetTo } from '../../navigation';
import { feedback } from '../../services/feedback';
import { useBackend } from '../../services/ServicesProvider';
import { useAppState, useTechSession } from '../../state/AppState';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, Header, Icon, Screen, Txt } from '../../ui';
import { Pop, Pulse } from '../../ui/motion';
import { VerificationPill } from '../../ui/TechIdentity';

export default function Verification() {
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const { updateTech, setRole } = useAppState();
  const v = session.profile.verification;
  const simulated = session.profile.identity?.simulated;
  // "You're verified" only for an explicit, real (not simulated) approval.
  const genuine = simulated === false;
  const stopped = v === 'REJECTED' || v === 'SUSPENDED';
  const last = useRef(v);

  useEffect(() => {
    if (v === 'APPROVED') return;
    let alive = true;
    const id = setInterval(() => {
      void backend.tech.me(session.token).then((p) => {
        if (alive) updateTech(p);
      }).catch(() => undefined);
    }, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [v, backend, session.token, updateTech]);

  useEffect(() => {
    if (last.current === v) return;
    last.current = v;
    if (v === 'APPROVED') feedback('success');
    else if (v === 'NEEDS_CORRECTION') feedback('warning');
  }, [v]);

  const steps = [
    { key: 'tverify.s1', done: true },
    { key: 'tverify.s2', done: v === 'APPROVED' },
    { key: 'tverify.s3', done: v === 'APPROVED' },
  ] as const;

  return (
    <Screen
      testID="tech-verification"
      wash={v === 'APPROVED' ? 'mint' : v === 'NEEDS_CORRECTION' || stopped ? 'peach' : 'sky'}
      header={<Header back={false} />}
      footer={v === 'APPROVED' ? <Button label={t('tverify.go')} trailingIcon="arrow-forward" onPress={() => resetTo('/tech/home')} testID="tverify-go" />
        : v === 'NEEDS_CORRECTION' ? <Button label={t('tverify.fix')} icon="create-outline" onPress={() => router.push({ pathname: '/tech/setup', params: { edit: '1' } })} testID="tverify-fix" />
          : <Button label={t('tverify.switch')} variant="outline" onPress={() => {
            setRole('CUSTOMER');
            resetTo('/');
          }} testID="tverify-switch" />}
    >
      <View style={styles.art} testID={`tverify-${v ?? 'NONE'}`}>
        {v === 'APPROVED' ? (
          <>
            <Pop><Art3D name="verify_ok" size={140} shadow /></Pop>
          </>
        ) : v === 'NEEDS_CORRECTION' || stopped ? <Art3D name="verify_fix" size={130} float shadow /> : (
          <>
            <Pulse size={200} color={colors.blue} />
            <Art3D name="verify_pending" size={120} float />
          </>
        )}
      </View>
      <Txt variant="title1" align="center" heading accessibilityLiveRegion="polite">
        {v === 'APPROVED' ? (genuine ? t('tverify.approved') : t('tverify.approvedDemo')) : v === 'NEEDS_CORRECTION' ? t('tverify.correction')
          : stopped ? t('tverify.stopped') : t('tverify.pending')}
      </Txt>
      <View style={styles.pill}><VerificationPill state={v} simulated={simulated} /></View>
      <Txt variant="body" color="inkMuted" align="center">
        {v === 'APPROVED' ? (genuine ? t('tverify.approvedBody') : t('tverify.approvedDemoBody')) : v === 'NEEDS_CORRECTION' ? t('tverify.correctionBody')
          : stopped ? t('tverify.stoppedBody') : t('tverify.pendingBody')}
      </Txt>
      {v === 'NEEDS_CORRECTION' && session.profile.correctionNote ? <Banner tone="warning" icon="alert-circle" text={l(session.profile.correctionNote)} /> : null}
      <Card style={styles.steps}>
        {steps.map((s) => (
          <View key={s.key} style={styles.step}>
            <View style={[styles.dot, s.done && styles.dotDone]}>{s.done ? <Icon name="checkmark" size={14} color="onNavy" /> : null}</View>
            <Txt variant="callout" color={s.done ? 'ink' : 'inkMuted'} style={styles.flex}>{t(s.key)}</Txt>
          </View>
        ))}
      </Card>
      {v === 'PENDING' ? <Banner tone="demo" text={t('tverify.demo')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  art: { alignItems: 'center', justifyContent: 'center', height: 210 },
  pill: { flexDirection: 'row', justifyContent: 'center' },
  steps: { gap: space.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success, borderRadius: radius.pill },
});
