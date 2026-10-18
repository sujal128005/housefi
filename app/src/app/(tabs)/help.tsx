// Help: chat with the Housefi assistant first (AI), call customer care if it can't help, and common questions.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n, type StringKey } from '../../i18n/I18n';
import { openWeb } from '../../services/links';
import { colors, GUTTER, radius, space } from '../../theme/tokens';
import { Card, DemoPill, Divider, Icon, ListRow, Pill, Screen, Tap, Txt, Wash } from '../../ui';
import { useCareCall } from '../../ui/useMaskedCall';
import { useSession } from '../../state/AppState';

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
  const session = useSession();
  const care = useCareCall(session.token);
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
            <Pill label={t('support.demoAi')} tone="info" icon="sparkles" />
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
      <ListRow icon="call-outline" title={t('help.contact')} subtitle={t('help.contactSub')} onPress={() => void care.call()} testID="help-call" />
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
      <ListRow icon="globe-outline" title={t('links.website')} subtitle="housefi.tech" onPress={() => openWeb()} testID="help-website" />
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
