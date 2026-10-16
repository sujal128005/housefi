// Help: chat with the Housefi assistant first (demo AI), call customer care if it can't help, and common questions.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n, type StringKey } from '../../i18n/I18n';
import { colors, GUTTER, radius, space } from '../../theme/tokens';
import { Card, DemoPill, Divider, Icon, ListRow, NotInDemoSheet, Pill, Screen, Tap, Txt, Wash } from '../../ui';

const FAQ: readonly (readonly [StringKey, StringKey])[] = [
  ['help.q1', 'help.a1'],
  ['help.q2', 'help.a2'],
  ['help.q5', 'help.a5'],
  ['help.q3', 'help.a3'],
  ['help.q4', 'help.a4'],
];

export default function Help() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<number | null>(0);
  const [call, setCall] = useState(false);
  return (
    <Screen
      testID="help"
      header={
        <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
          <Txt variant="title1" heading style={styles.flex}>{t('help.title')}</Txt>
          <DemoPill />
        </View>
      }
    >
      <Tap onPress={() => router.push('/support')} testID="help-chat" accessibilityLabel={t('help.chat')} scale={0.98} haptic>
        <Wash name="lavender" style={styles.hero}>
          <View style={styles.flex}>
            <Pill label={t('support.demoAi')} tone="demo" icon="sparkles" />
            <Txt variant="title2">{t('help.chat')}</Txt>
            <Txt variant="footnote" color="inkMuted">{t('help.chatSub')}</Txt>
            <View style={styles.cta}>
              <Icon name="chatbubbles" size={18} color="onNavy" />
              <Txt variant="label" color="onNavy">{t('help.chatCta')}</Txt>
            </View>
          </View>
          <Art3D name="robot" size={104} float />
        </Wash>
      </Tap>
      <ListRow icon="call-outline" title={t('help.contact')} subtitle={t('help.contactSub')} onPress={() => setCall(true)} testID="help-call" />
      <Txt variant="title3" heading>{t('help.faq')}</Txt>
      <Card style={styles.faq}>
        {FAQ.map(([q, a], i) => (
          <View key={q}>
            {i > 0 ? <Divider /> : null}
            <Tap onPress={() => setOpen(open === i ? null : i)} style={styles.q} accessibilityState={{ expanded: open === i }} accessibilityLabel={t(q)} scale={1}>
              <Txt variant="bodyStrong" style={styles.flex}>{t(q)}</Txt>
              <Icon name={open === i ? 'chevron-up' : 'chevron-down'} size={18} color="inkMuted" />
            </Tap>
            {open === i ? <Txt variant="callout" color="inkMuted" style={styles.a}>{t(a)}</Txt> : null}
          </View>
        ))}
      </Card>
      <ListRow icon="document-text-outline" title={t('account.legal')} onPress={() => router.push('/legal')} testID="help-legal" />
      <NotInDemoSheet visible={call} title={t('help.contact')} onClose={() => setCall(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: space.xs },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: GUTTER, paddingBottom: space.sm },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xxl, overflow: 'hidden' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.navy, marginTop: space.sm },
  faq: { paddingVertical: space.xs },
  q: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  a: { paddingBottom: space.md },
});
