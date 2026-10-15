import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mascot } from '../../illustrations/Mascot';
import { useI18n, type StringKey } from '../../i18n/I18n';
import { colors, GUTTER, radius, space } from '../../theme/tokens';
import { Card, DemoPill, Divider, Icon, ListRow, NotInDemoSheet, Screen, Tap, Txt, Wash } from '../../ui';

const FAQ: readonly (readonly [StringKey, StringKey])[] = [
  ['help.q1', 'help.a1'],
  ['help.q2', 'help.a2'],
  ['help.q3', 'help.a3'],
  ['help.q4', 'help.a4'],
];

export default function Help() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<number | null>(0);
  const [contact, setContact] = useState(false);
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
      <Wash name="peach" style={styles.hero}>
        <View style={styles.flex}>
          <Txt variant="title3">{t('help.contact')}</Txt>
          <Txt variant="footnote" color="inkMuted">{t('help.contactSub')}</Txt>
          <Tap onPress={() => setContact(true)} style={styles.cta} accessibilityLabel={t('help.contact')} testID="help-contact">
            <Icon name="chatbubbles" size={18} color="onNavy" />
            <Txt variant="label" color="onNavy">{t('help.contact')}</Txt>
          </Tap>
        </View>
        <Mascot pose="thumbs" size={110} />
      </Wash>
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
      <NotInDemoSheet visible={contact} title={t('help.contact')} onClose={() => setContact(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: GUTTER, paddingBottom: space.sm },
  hero: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, padding: space.lg, paddingBottom: 0, borderRadius: radius.xxl, overflow: 'hidden' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.navy, marginTop: space.md, marginBottom: space.lg },
  faq: { paddingVertical: space.xs },
  q: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  a: { paddingBottom: space.md },
});
