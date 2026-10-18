// All categories as large tiles.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n/I18n';
import { useBackend, useQuery } from '../services/ServicesProvider';
import { radius, space } from '../theme/tokens';
import { ErrorView, Header, Screen, Skeleton } from '../ui';
import { CategoryTile } from '../ui/CategoryTile';

export default function AllServices() {
  const { t } = useI18n();
  const backend = useBackend();
  const q = useQuery(() => backend.catalog.categories(), [backend]);
  return (
    <Screen testID="services" wash="lavender" header={<Header title={t('catalog.all')} />}>
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} title={t('catalog.loadError')} /> : null}
      <View style={styles.grid}>
        {q.loading
          ? Array.from({ length: 6 }, (_, k) => <View key={k} style={styles.cell}><Skeleton style={styles.skel} /></View>)
          : (q.data ?? []).map((c) => (
              <View key={c.id} style={styles.cell}>
                <CategoryTile size="lg" category={c} onPress={() => router.push(`/category/${c.id}`)} />
              </View>
            ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.sm, rowGap: space.xl },
  cell: { width: '50%', paddingHorizontal: space.sm },
  skel: { width: '100%', aspectRatio: 1, borderRadius: radius.xxl },
});
