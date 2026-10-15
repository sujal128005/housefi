// Demo settings: choose what the simulated backend does (matching outcome, a one-off failure) and reset demo data.
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import type { MatchingScenario } from '../domain/rules';
import { useI18n } from '../i18n/I18n';
import { resetTo } from '../navigation';
import type { DemoSettings, FailNext } from '../services/api';
import { useBackend } from '../services/ServicesProvider';
import { useAppState } from '../state/AppState';
import { useDraft } from '../state/BookingDraft';
import { colors, space } from '../theme/tokens';
import { Banner, Button, Card, ConfirmSheet, Divider, Header, RadioDot, Screen, Tap, Txt, useToast } from '../ui';

const SCENARIOS: readonly MatchingScenario[] = ['QUICK', 'SLOW', 'NONE'];

export default function DemoSettingsScreen() {
  const { t } = useI18n();
  const backend = useBackend();
  const toast = useToast();
  const { signOut } = useAppState();
  const draft = useDraft();
  const [s, setS] = useState<DemoSettings | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    void backend.demo?.settings().then(setS);
  }, [backend]);

  const update = async (patch: Partial<DemoSettings>) => {
    if (backend.demo) setS(await backend.demo.updateSettings(patch));
  };

  const failOn = (v: FailNext) => s?.failNext === v;

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
      <Button label={t('demo.reset')} icon="trash-outline" variant="danger" onPress={() => setConfirm(true)} testID="demo-reset" />
      <ConfirmSheet visible={confirm} title={t('demo.resetTitle')} body={t('demo.resetBody')} icon="trash" confirmLabel={t('demo.reset')} confirmVariant="danger"
        onCancel={() => setConfirm(false)} onConfirm={() => {
          setConfirm(false);
          void (async () => {
            await backend.demo?.reset();
            draft.clear();
            await signOut();
            toast.show(t('demo.resetDone'), 'checkmark-circle');
            resetTo('/auth/phone');
          })();
        }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
});
