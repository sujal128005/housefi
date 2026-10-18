// Search services and categories in English or Telugu.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { categoryById, serviceById, POPULAR_SEARCHES } from '../data/catalog';
import { search } from '../domain/rules';
import { Art3D } from '../illustrations/Art3D';
import { formatRupees } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { fontFamily } from '../theme/fonts';
import { colors, radius, space } from '../theme/tokens';
import { BackButton, Chip, EmptyState, Icon, ListRow, Screen, Tap, Txt } from '../ui';
import { CategoryBadge } from '../ui/CategoryTile';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Search() {
  const { t, l, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const res = search(q);
  const empty = q.trim().length > 0 && res.categories.length === 0 && res.services.length === 0;

  return (
    <Screen
      testID="search"
      header={
        <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
          <BackButton />
          <View style={styles.box}>
            <Icon name="search" size={20} color="inkMuted" />
            <TextInput
              testID="search-input"
              value={q}
              onChangeText={setQ}
              autoFocus
              placeholder={t('search.placeholder')}
              placeholderTextColor={colors.inkSubtle}
              returnKeyType="search"
              accessibilityLabel={t('home.search')}
              style={[styles.input, { fontFamily: fontFamily('medium', locale) }]}
            />
            {q ? (
              <Tap onPress={() => setQ('')} accessibilityLabel={t('common.close')} style={styles.clear}>
                <Icon name="close-circle" size={20} color="inkSubtle" />
              </Tap>
            ) : null}
          </View>
        </View>
      }
    >
      {q.trim().length === 0 ? (
        <View style={styles.block}>
          <Txt variant="title3" heading>{t('search.popular')}</Txt>
          <View style={styles.chips}>
            {POPULAR_SEARCHES.map((id) => {
              const s = serviceById(id);
              return s ? <Chip key={id} label={l(s.name)} selected={false} icon="trending-up" onPress={() => router.push(`/service/${id}`)} /> : null;
            })}
          </View>
        </View>
      ) : null}
      {empty ? (
        <EmptyState testID="search-empty" art={<Art3D name="no_results" size={120} float shadow />} title={t('search.emptyTitle', { q: q.trim() })} body={t('search.emptyBody')}
          action={t('catalog.all')} onAction={() => router.push('/services')} />
      ) : null}
      {res.categories.length > 0 ? (
        <View style={styles.block}>
          <Txt variant="caption" color="inkMuted">{t('search.categories')}</Txt>
          {res.categories.map((c) => (
            <Tap key={c.id} onPress={() => router.push(`/category/${c.id}`)} style={styles.result} accessibilityLabel={l(c.name)} testID={`result-cat-${c.id}`}>
              <CategoryBadge category={c} size={48} />
              <View style={styles.flex}>
                <Txt variant="bodyStrong">{l(c.name)}</Txt>
                <Txt variant="footnote" color="inkMuted">{l(c.tagline)}</Txt>
              </View>
              <Icon name="chevron-forward" size={18} color="inkSubtle" />
            </Tap>
          ))}
        </View>
      ) : null}
      {res.services.length > 0 ? (
        <View style={styles.block}>
          <Txt variant="caption" color="inkMuted">{t('search.services')}</Txt>
          {res.services.map((s) => {
            const c = categoryById(s.categoryId);
            return (
              <ListRow key={s.id} testID={`result-svc-${s.id}`} title={l(s.name)} subtitle={`${c ? l(c.name) : ''} · ${t('catalog.visitOnly', { fee: formatRupees(s.visitFee) })}`}
                icon="construct-outline" onPress={() => router.push(`/service/${s.id}`)} />
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  box: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 50, paddingHorizontal: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.blue },
  input: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: space.sm },
  clear: { padding: space.xs },
  block: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  result: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64 },
});
