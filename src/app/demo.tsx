// Demo settings: choose what the simulated backend does (matching outcome, a one-off failure) and reset demo data.
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import type { MatchingScenario, PaymentOutcome } from '../domain/rules';
import { useI18n } from '../i18n/I18n';
import { resetTo } from '../navigation';
import type { DemoSettings, FailNext } from '../services/api';
import { useBackend } from '../services/ServicesProvider';
import { useAppState } from '../state/AppState';
import { useDraft } from '../state/BookingDraft';
import { colors, space } from '../theme/tokens';
import { Banner, Button, Card, ConfirmSheet, Divider, Header, RadioDot, Screen, Tap, Txt, useToast } from '../ui';

const SCENARIOS: readonly MatchingScenario[] = ['QUICK', 'SLOW', 'NONE'];
const PAYMENTS: readonly PaymentOutcome[] = ['SUCCESS', 'PENDING', 'FAILED'];
const PRACTICE: readonly DemoSettings['practiceCustomer'][] = ['APPROVE', 'REVISION', 'DECLINE'];
const REVIEWS: readonly DemoSettings['verification'][] = ['APPROVE', 'CORRECTION'];

/** Demo settings exist only with the demo backend; a link to this screen in a live build goes home. */
export default function DemoSettingsRoute() {
  const backend = useBackend();
  if (!backend.demo) return <Redirect href="/" />;
  return <DemoSettingsScreen />;
}

function DemoSettingsScreen() {
  const { t } = useI18n();
  const backend = useBackend();
  const toast = useToast();
  const { signOut, techSignOut, techSession, updateTech } = useAppState();
  const draft = useDraft();
  const [s, setS] = useState<DemoSettings | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [boom, setBoom] = useState(false);

  useEffect(() => {
    void backend.demo?.settings().then(setS);
  }, [backend]);

  const update = async (patch: Partial<DemoSettings>) => {
    if (backend.demo) setS(await backend.demo.updateSettings(patch));
  };

  const failOn = (v: FailNext) => s?.failNext === v;
  const techV = techSession?.profile.verification;
  const canSuspend = !!techSession?.profile.identity && (techV === 'APPROVED' || techV === 'SUSPENDED');
  const suspend = async (on: boolean) => {
    if (!backend.demo || !techSession) return;
    try {
      await backend.demo.setSuspended(techSession.token, on);
      updateTech(await backend.tech.me(techSession.token));
      toast.show(on ? t('id.v.SUSPENDED') : t('id.v.DEMO'), on ? 'ban' : 'flask');
    } catch {
      toast.show(t('error.generic'), 'alert-circle');
    }
  };

  return (
    <Screen testID="demo-settings" header={<Header title={t('demo.title')} />}>
      <Banner tone="demo" text={t('demo.body')} />
      {s ? (
        <>
          <Card style={styles.card}>
            <Txt variant="title3" heading>{t('demo.matching')}</Txt>
            {SCENARIOS.map((m) => (
              <Tap key={m} onPress={() => void update({ matching: m })} style={styles.option} accessibilityRole="radio" accessibilityState={{ selected: s.matching === m }}
                accessibilityLabel={t(`demo.matching.${m}`)} testID={`demo-matching-${m}`}>
                <RadioDot on={s.matching === m} />
                <Txt variant="callout" style={styles.flex}>{t(`demo.matching.${m}`)}</Txt>
              </Tap>
            ))}
          </Card>
          <Card style={styles.card}>
            <Txt variant="title3" heading>{t('demo.payment')}</Txt>
            {PAYMENTS.map((m) => (
              <Tap key={m} onPress={() => void update({ payment: m })} style={styles.option} accessibilityRole="radio" accessibilityState={{ selected: s.payment === m }}
                accessibilityLabel={t(`demo.payment.${m}`)} testID={`demo-payment-${m}`}>
                <RadioDot on={s.payment === m} />
                <Txt variant="callout" style={styles.flex}>{t(`demo.payment.${m}`)}</Txt>
              </Tap>
            ))}
            <Txt variant="footnote" color="inkMuted">{t('demo.paymentSub')}</Txt>
          </Card>
          <Card style={styles.card}>
            <Txt variant="title3" heading>{t('demo.practice')}</Txt>
            {PRACTICE.map((m) => (
              <Tap key={m} onPress={() => void update({ practiceCustomer: m })} style={styles.option} accessibilityRole="radio" accessibilityState={{ selected: s.practiceCustomer === m }}
                accessibilityLabel={t(`demo.practice.${m}`)} testID={`demo-practice-${m}`}>
                <RadioDot on={s.practiceCustomer === m} />
                <Txt variant="callout" style={styles.flex}>{t(`demo.practice.${m}`)}</Txt>
              </Tap>
            ))}
            <Txt variant="footnote" color="inkMuted">{t('demo.practiceSub')}</Txt>
            <Divider />
            <Txt variant="title3" heading>{t('demo.review')}</Txt>
            {REVIEWS.map((m) => (
              <Tap key={m} onPress={() => void update({ verification: m })} style={styles.option} accessibilityRole="radio" accessibilityState={{ selected: s.verification === m }}
                accessibilityLabel={t(`demo.review.${m}`)} testID={`demo-review-${m}`}>
                <RadioDot on={s.verification === m} />
                <Txt variant="callout" style={styles.flex}>{t(`demo.review.${m}`)}</Txt>
              </Tap>
            ))}
          </Card>
          <Card style={styles.card}>
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Txt variant="bodyStrong">{t('demo.extra')}</Txt>
                <Txt variant="footnote" color="inkMuted">{t('demo.extraSub')}</Txt>
              </View>
              <Switch value={s.extraWork} onValueChange={(v) => void update({ extraWork: v })} testID="demo-extra"
                trackColor={{ true: colors.demo, false: colors.lineStrong }} thumbColor={colors.surface} accessibilityLabel={t('demo.extra')} />
            </View>
            <Divider />
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Txt variant="bodyStrong">{t('demo.network')}</Txt>
                <Txt variant="footnote" color="inkMuted">{t('demo.networkSub')}</Txt>
              </View>
              <Switch value={failOn('NETWORK')} onValueChange={(v) => void update({ failNext: v ? 'NETWORK' : 'OFF' })} testID="demo-fail-network"
                trackColor={{ true: colors.demo, false: colors.lineStrong }} thumbColor={colors.surface} accessibilityLabel={t('demo.network')} />
            </View>
            <Divider />
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Txt variant="bodyStrong">{t('demo.slot')}</Txt>
                <Txt variant="footnote" color="inkMuted">{t('demo.slotSub')}</Txt>
              </View>
              <Switch value={failOn('SLOT_TAKEN')} onValueChange={(v) => void update({ failNext: v ? 'SLOT_TAKEN' : 'OFF' })} testID="demo-fail-slot"
                trackColor={{ true: colors.demo, false: colors.lineStrong }} thumbColor={colors.surface} accessibilityLabel={t('demo.slot')} />
            </View>
          </Card>
        </>
      ) : null}
      {canSuspend ? (
        <Card style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Txt variant="bodyStrong">{t('demo.suspend')}</Txt>
              <Txt variant="footnote" color="inkMuted">{t('demo.suspendSub')}</Txt>
            </View>
            <Switch value={techV === 'SUSPENDED'} onValueChange={(v) => void suspend(v)} testID="demo-suspend"
              trackColor={{ true: colors.demo, false: colors.lineStrong }} thumbColor={colors.surface} accessibilityLabel={t('demo.suspend')} />
          </View>
        </Card>
      ) : null}
      <Card style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Txt variant="bodyStrong">{t('demo.crash')}</Txt>
            <Txt variant="footnote" color="inkMuted">{t('demo.crashSub')}</Txt>
          </View>
          <Button label={t('demo.crashCta')} variant="outline" size="sm" onPress={() => setBoom(true)} testID="demo-crash" />
        </View>
      </Card>
      {boom ? <Boom /> : null}
      <Button label={t('demo.reset')} icon="trash-outline" variant="danger" onPress={() => setConfirm(true)} testID="demo-reset" />
      <ConfirmSheet visible={confirm} title={t('demo.resetTitle')} body={t('demo.resetBody')} icon="trash" confirmLabel={t('demo.reset')} confirmVariant="danger"
        onCancel={() => setConfirm(false)} onConfirm={() => {
          setConfirm(false);
          void (async () => {
            await backend.demo?.reset();
            draft.reset();
            await signOut();
            await techSignOut();
            toast.show(t('demo.resetDone'), 'checkmark-circle');
            resetTo('/auth/phone');
          })();
        }} />
    </Screen>
  );
}

/** Demo only: fails while rendering, to show the branded error screen and its recovery. */
function Boom(): never {
  throw new Error('Demo: simulated app error');
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
});
