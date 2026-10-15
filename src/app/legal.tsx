import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n/I18n';
import { space } from '../theme/tokens';
import { Banner, Card, Header, Icon, Screen, Txt } from '../ui';

export default function Legal() {
  const { t } = useI18n();
  return (
    <Screen testID="legal" header={<Header title={t('legal.title')} />}>
      <Banner tone="demo" text={t('legal.draft')} />
      <Card style={styles.card}>
        {(['legal.p1', 'legal.p2', 'legal.p3'] as const).map((k) => (
          <View key={k} style={styles.row}>
            <Icon name="shield-checkmark" size={20} color="blue" />
            <Txt variant="body" style={styles.flex}>{t(k)}</Txt>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
