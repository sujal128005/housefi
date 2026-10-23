// Learn: Housefi's video courses for technicians, open across trades (a plumber can learn electrical work too). Basic
// and safety courses are free; advanced ones are free with a 3.8★ rating, otherwise 99 rupees. A finished course
// (every lesson watched, the quiz passed) adds a Housefi certificate to the profile and ID card.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { categoryById } from '../../../data/catalog';
import type { CourseCard, CourseLevel, CoursesOverview } from '../../../domain/types';
import { Art3D } from '../../../illustrations/Art3D';
import { useI18n, type StringKey } from '../../../i18n/I18n';
import { useBackend } from '../../../services/ServicesProvider';
import { useTechSession } from '../../../state/AppState';
import { colors, radius, space } from '../../../theme/tokens';
import { Banner, Card, EmptyState, ErrorBanner, Pill, Screen, Segmented, Skeleton, Txt } from '../../../ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Filter = 'ALL' | CourseLevel;

export default function Learn() {
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<CoursesOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  useFocusEffect(useCallback(() => {
    let alive = true;
    void backend.tech.courses(session.token).then((d) => alive && setData(d)).catch((e: unknown) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [backend, session.token]));

  const shown = (data?.courses ?? []).filter((c) => filter === 'ALL' || c.level === filter);

  return (
    <Screen
      testID="tech-learn"
      header={<View style={[styles.header, { paddingTop: insets.top + space.md }]}><Txt variant="title1" heading>{t('learn.title')}</Txt></View>}
    >
      <Txt variant="body" color="inkMuted">{t('learn.intro')}</Txt>
      <ErrorBanner error={error} />
      {!data ? <Skeleton style={styles.skeleton} /> : data.courses.length === 0 ? (
        <EmptyState art={<Art3D name="toolbox" size={96} float />} title={t('learn.empty')} testID="learn-empty" />
      ) : (
        <>
          <Banner tone="info" icon="pricetag-outline" text={t('learn.priceNote', { rating: data.freeFromRating, price: data.price })} />
          <Segmented<Filter> value={filter} onChange={setFilter} options={(['ALL', 'BASIC', 'SAFETY', 'ADVANCED'] as const).map((f) => ({ value: f, label: f === 'ALL' ? t('learn.all') : t(`learn.level.${f}` as StringKey) }))} />
          {shown.map((c) => <CourseRow key={c.id} c={c} l={l} t={t} />)}
        </>
      )}
    </Screen>
  );
}

function CourseRow({ c, l, t }: { readonly c: CourseCard; readonly l: ReturnType<typeof useI18n>['l']; readonly t: ReturnType<typeof useI18n>['t'] }) {
  const cat = c.categoryId ? categoryById(c.categoryId) : null;
  const price = c.access === 'PAY' ? t('learn.price', { price: c.price }) : c.access === 'RATING' ? t('learn.freeRating') : t('learn.free');
  return (
    <Card onPress={() => router.push({ pathname: '/tech/course/[id]', params: { id: c.id } })} style={styles.card} testID={`learn-course-${c.id}`} accessibilityLabel={l(c.title)}>
      <View style={styles.row}>
        <Art3D name={c.level === 'SAFETY' ? 'shield' : cat?.art ?? 'toolbox'} size={52} />
        <View style={styles.flex}>
          <Txt variant="caption" color="inkMuted">{(cat ? l(cat.name) : t('learn.forAll'))} · {t(`learn.level.${c.level}` as StringKey)}</Txt>
          <Txt variant="bodyStrong">{l(c.title)}</Txt>
          <Txt variant="footnote" color="inkMuted" numberOfLines={2}>{l(c.summary)}</Txt>
        </View>
      </View>
      <View style={styles.meta}>
        <Txt variant="footnote" color="inkMuted">{t('learn.lessons', { n: c.lessons, min: Math.max(1, Math.round(c.durationSec / 60)) })}</Txt>
        {c.completed ? <Pill tone="success" icon="ribbon" label={t('learn.completed')} />
          : <Pill tone={c.access === 'PAY' ? 'warning' : 'success'} label={price} />}
      </View>
      {c.enrolled && !c.completed ? (
        <View style={styles.track}><View style={[styles.fill, { width: `${(100 * c.completedLessons) / Math.max(1, c.lessons)}%` }]} /></View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  skeleton: { height: 300, borderRadius: radius.lg },
  card: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.cyan },
});
