import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n/I18n';
import { openWeb, PUBLISHED_PRIVACY_URL, PUBLISHED_TERMS_URL } from '../services/links';
import { space } from '../theme/tokens';
import { Banner, Card, Header, Icon, ListRow, Screen, Txt } from '../ui';

export default function Legal() {
  const { t } = useI18n();
  return (
    <Screen testID="legal" header={<Header title={t('legal.title')} />}>
      {/* The published versions on housefi.tech replace the draft as soon as their addresses are set (services/links). */}
      {PUBLISHED_TERMS_URL ? <ListRow icon="document-text-outline" title={t('links.terms')} subtitle="housefi.tech" onPress={() => openWeb(PUBLISHED_TERMS_URL!)} testID="legal-terms" /> : null}
      {PUBLISHED_PRIVACY_URL ? <ListRow icon="lock-closed-outline" title={t('links.privacy')} subtitle="housefi.tech" onPress={() => openWeb(PUBLISHED_PRIVACY_URL!)} testID="legal-privacy" /> : null}
      {!PUBLISHED_TERMS_URL ? <Banner tone="demo" text={t('legal.draft')} /> : null}
      <Card style={styles.card}>
        {(['legal.p1', 'legal.p2', 'legal.p3'] as const).map((k) => (
          <View key={k} style={styles.row}>
            <Icon name="shield-checkmark" size={20} color="blue" />
            <Txt variant="body" style={styles.flex}>{t(k)}</Txt>
          </View>
        ))}
      </Card>
      <ListRow icon="globe-outline" title={t('links.website')} subtitle="housefi.tech" onPress={() => openWeb()} testID="legal-website" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
