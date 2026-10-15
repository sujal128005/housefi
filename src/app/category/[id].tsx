// One category: its services as rows with the visit fee.
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { categoryById } from '../../data/catalog';
import { CategoryArt } from '../../illustrations/CategoryArt';
import { formatRupees } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { colors, radius, space } from '../../theme/tokens';
import { Card, EmptyState, ErrorView, Header, Icon, Screen, Skeleton, Txt, Wash } from '../../ui';
import { EmptyBoxArt } from '../../illustrations/Scenes';

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l } = useI18n();
  const backend = useBackend();
  const cat = categoryById(id);
  const q = useQuery(() => backend.catalog.services(id), [backend, id]);

  if (!cat) {
    return (
      <Screen header={<Header />}>
        <EmptyState art={<EmptyBoxArt />} title={t('error.generic')} action={t('common.back')} onAction={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen testID={`category-${cat.id}`} header={<Header title={l(cat.name)} />}>
      <Wash name={cat.wash} style={styles.hero}>
        <View style={styles.flex}>
          <Txt variant="title1" heading>{l(cat.name)}</Txt>
          <Txt variant="callout" color="inkMuted">{l(cat.tagline)}</Txt>
          {q.data ? <Txt variant="caption" color="blue" style={styles.count}>{t('catalog.count', { count: q.data.length })}</Txt> : null}
        </View>
        <CategoryArt name={cat.art} size={96} />
      </Wash>
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} title={t('catalog.loadError')} /> : null}
      {q.loading ? Array.from({ length: 3 }, (_, k) => <Skeleton key={k} style={styles.skel} />) : null}
      {(q.data ?? []).map((s) => (
        <Card key={s.id} onPress={() => router.push(`/service/${s.id}`)} testID={`svc-${s.id}`} accessibilityLabel={l(s.name)}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Txt variant="bodyStrong">{l(s.name)}</Txt>
              <Txt variant="footnote" color="inkMuted" numberOfLines={2}>{l(s.description)}</Txt>
              <View style={styles.meta}>
                <Icon name="star" size={14} color="yellow" />
                <Txt variant="caption" color="inkMuted">{s.rating.toFixed(1)}</Txt>
                <View style={styles.dot} />
                <Txt variant="caption" color="blue">{t('catalog.visitFee', { fee: formatRupees(s.visitFee) })}</Txt>
              </View>
            </View>
            <View style={styles.go}><Icon name="chevron-forward" size={18} color="navy" /></View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 4 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.xl, borderRadius: radius.xxl },
  count: { marginTop: space.xs },
  skel: { height: 96, borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.xs },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginHorizontal: 4 },
  go: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
});
