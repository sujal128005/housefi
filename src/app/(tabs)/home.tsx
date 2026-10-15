// Customer home: greeting and location, search, the active booking, a hero banner, categories, trust points and
// popular services.
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { categoryById, SERVICES } from '../../data/catalog';
import { isActive } from '../../domain/rules';
import type { Address, Booking, Service } from '../../domain/types';
import { CategoryArt } from '../../illustrations/CategoryArt';
import { Mascot } from '../../illustrations/Mascot';
import { formatRupees } from '../../i18n/format';
import { useI18n, type StringKey } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { colors, GUTTER, radius, shadow, space } from '../../theme/tokens';
import { DemoPill, ErrorView, Icon, SectionTitle, Sheet, Skeleton, Tap, Txt, Wash, type IconName } from '../../ui';
import { BookingCard } from '../../ui/BookingCard';
import { CategoryTile } from '../../ui/CategoryTile';
import { EmptyBoxArt } from '../../illustrations/Scenes';

function greetingKey(h: number): StringKey {
  return h < 12 ? 'home.morning' : h < 17 ? 'home.afternoon' : 'home.evening';
}

export default function Home() {
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const insets = useSafeAreaInsets();
  const [bell, setBell] = useState(false);
  const [extra, setExtra] = useState<{ bookings: readonly Booking[]; addresses: readonly Address[] }>({ bookings: [], addresses: [] });
  const cats = useQuery(() => backend.catalog.categories(), [backend]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    void Promise.all([backend.bookings.list(session.token), backend.addresses.list(session.token)])
      .then(([bookings, addresses]) => {
        if (alive) setExtra({ bookings, addresses });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [backend, session.token]));

  const active = extra.bookings.find((b) => isActive(b.status));
  const home = extra.addresses[0];
  const first = session.customer.name.split(' ')[0] ?? '';

  return (
    <View style={styles.root} testID="home">
      <Wash name="sky" fade style={styles.wash} />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + space.md }]} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <View style={styles.avatar}>
            <Txt variant="title3" color="onNavy">{(first[0] ?? 'H').toUpperCase()}</Txt>
          </View>
          <View style={styles.flex}>
            <Txt variant="footnote" color="inkMuted">{t(greetingKey(new Date().getHours()))},</Txt>
            <Txt variant="title2" numberOfLines={1} testID="home-name">{first} 👋</Txt>
          </View>
          <DemoPill />
          <Tap onPress={() => setBell(true)} style={styles.bell} accessibilityLabel={t('home.notifications')} testID="home-bell">
            <Icon name="notifications-outline" size={22} color="ink" />
          </Tap>
        </View>

        <Tap onPress={() => router.push('/addresses')} style={styles.location} accessibilityLabel={home ? `${home.street}, ${home.city}` : t('home.addAddress')} testID="home-location">
          <Icon name="location" size={18} color="blue" />
          <Txt variant="label" numberOfLines={1} style={styles.shrink}>{home ? `${home.street}, ${home.city}` : t('home.addAddress')}</Txt>
          <Icon name="chevron-down" size={16} color="inkMuted" />
        </Tap>

        <Tap onPress={() => router.push('/search')} style={styles.search} accessibilityRole="search" accessibilityLabel={t('home.search')} testID="home-search" scale={0.99}>
          <Icon name="search" size={20} color="inkMuted" />
          <Txt variant="callout" color="inkSubtle" style={styles.flex}>{t('home.search')}</Txt>
        </Tap>

        {active ? (
          <View style={styles.block}>
            <SectionTitle title={t('home.active')} />
            <BookingCard booking={active} onPress={() => router.push(`/booking/${active.id}`)} />
          </View>
        ) : null}

        <LinearGradient colors={['#2A3F8F', colors.navy]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroText}>
            <Txt variant="title2" color="onNavy">{t('home.hero.title')}</Txt>
            <Tap onPress={() => router.push('/services')} style={styles.heroCta} accessibilityLabel={t('home.hero.cta')} testID="home-hero-cta" haptic>
              <Txt variant="label" color="navy">{t('home.hero.cta')}</Txt>
              <Icon name="arrow-forward" size={16} color="navy" />
            </Tap>
          </View>
          <View style={styles.heroArt}><Mascot pose="wrench" size={128} /></View>
        </LinearGradient>

        <View style={styles.block}>
          <SectionTitle title={t('home.services')} action={t('home.viewAll')} onAction={() => router.push('/services')} />
          {cats.error ? <ErrorView error={cats.error} onRetry={cats.reload} title={t('catalog.loadError')} /> : null}
          <View style={styles.grid}>
            {cats.loading
              ? Array.from({ length: 6 }, (_, k) => <View key={k} style={styles.cell}><Skeleton style={styles.skelTile} /></View>)
              : (cats.data ?? []).map((c) => (
                  <View key={c.id} style={styles.cell}>
                    <CategoryTile category={c} onPress={() => router.push(`/category/${c.id}`)} />
                  </View>
                ))}
          </View>
        </View>

        <View style={styles.block}>
          <SectionTitle title={t('home.why')} />
          <View style={styles.whyRow}>
            <Why icon="shield-checkmark" label={t('home.why.verified')} />
            <Why icon="checkmark-done-circle" label={t('home.why.approve')} />
            <Why icon="wallet" label={t('home.why.payAfter')} />
          </View>
        </View>

        <View style={styles.block}>
          <SectionTitle title={t('home.popular')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.popular} style={styles.bleed}>
            {SERVICES.filter((s) => s.popular).map((s) => <PopularCard key={s.id} service={s} label={l(s.name)} fee={t('catalog.visitFee', { fee: formatRupees(s.visitFee) })} />)}
          </ScrollView>
        </View>
      </ScrollView>

      {/* keeps scrolled content from running under the status bar */}
      <View pointerEvents="none" style={[styles.scrim, { height: insets.top }]} />

      <Sheet visible={bell} onClose={() => setBell(false)} testID="notifications-sheet">
        <Txt variant="title2" heading>{t('home.notifications')}</Txt>
        <View style={styles.center}><EmptyBoxArt size={120} /></View>
        <Txt variant="body" color="inkMuted" align="center">{t('home.notificationsEmpty')}</Txt>
      </Sheet>
    </View>
  );
}

function Why({ icon, label }: { readonly icon: IconName; readonly label: string }) {
  return (
    <View style={styles.why}>
      <View style={styles.whyIcon}><Icon name={icon} size={22} color="blue" /></View>
      <Txt variant="caption" align="center" color="ink">{label}</Txt>
    </View>
  );
}

function PopularCard({ service, label, fee }: { readonly service: Service; readonly label: string; readonly fee: string }) {
  const cat = categoryById(service.categoryId);
  return (
    <Tap onPress={() => router.push(`/service/${service.id}`)} style={styles.pop} accessibilityLabel={`${label}, ${fee}`} testID={`popular-${service.id}`} scale={0.98}>
      {cat ? (
        <Wash name={cat.wash} style={styles.popArt}><CategoryArt name={cat.art} size={64} /></Wash>
      ) : null}
      <Txt variant="label" numberOfLines={2}>{label}</Txt>
      <View style={styles.popMeta}>
        <Icon name="star" size={14} color="yellow" />
        <Txt variant="caption" color="inkMuted">{service.rating.toFixed(1)}</Txt>
      </View>
      <Txt variant="caption" color="blue">{fee}</Txt>
    </Tap>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(246,247,252,0.94)' },
  wash: { position: 'absolute', left: 0, right: 0, top: 0, height: 420 },
  content: { paddingHorizontal: GUTTER, paddingBottom: space.x4, gap: space.lg },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  center: { alignItems: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  bell: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  location: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.8)', maxWidth: '100%' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 54, paddingHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  block: { gap: space.md },
  hero: { borderRadius: radius.xxl, flexDirection: 'row', overflow: 'hidden', minHeight: 156, ...shadow.raised },
  heroText: { flex: 1, padding: space.xl, gap: space.lg, justifyContent: 'center' },
  heroCta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', backgroundColor: colors.yellow, minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill },
  heroArt: { width: 128, justifyContent: 'flex-end', alignItems: 'center', marginRight: -4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.sm, rowGap: space.lg },
  cell: { width: '33.33%', paddingHorizontal: space.sm },
  skelTile: { width: '100%', aspectRatio: 1, borderRadius: radius.xl },
  whyRow: { flexDirection: 'row', gap: space.sm },
  why: { flex: 1, alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  whyIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  bleed: { marginHorizontal: -GUTTER },
  popular: { paddingHorizontal: GUTTER, gap: space.md },
  pop: { width: 148, padding: space.md, gap: space.xs, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  popArt: { height: 96, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  popMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
