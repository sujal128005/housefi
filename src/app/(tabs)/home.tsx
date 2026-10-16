// Customer home: greeting and location, search, the live booking, "Snap the problem" (AI), big 3D categories and the
// AI-ranked top 6 problems in the customer's locality, one tap away. The bell opens the notification inbox.
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { categoryById, serviceById } from '../../data/catalog';
import { isActive } from '../../domain/rules';
import type { Address, Booking } from '../../domain/types';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n, type StringKey } from '../../i18n/I18n';
import type { AppNotification } from '../../services/api';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { colors, GUTTER, radius, shadow, space } from '../../theme/tokens';
import { DemoPill, ErrorView, Icon, Pill, SectionTitle, Sheet, Skeleton, Tap, Txt, Wash } from '../../ui';
import { BookingCard } from '../../ui/BookingCard';
import { CategoryTile } from '../../ui/CategoryTile';
import { Appear } from '../../ui/motion';
import { NotificationList } from '../../ui/Notifications';

function greetingKey(h: number): StringKey {
  return h < 12 ? 'home.morning' : h < 17 ? 'home.afternoon' : 'home.evening';
}

export default function Home() {
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const draft = useDraft();
  const insets = useSafeAreaInsets();
  const [bell, setBell] = useState(false);
  const [extra, setExtra] = useState<{ bookings: readonly Booking[]; addresses: readonly Address[]; inbox: readonly AppNotification[] }>({ bookings: [], addresses: [], inbox: [] });
  const cats = useQuery(() => backend.catalog.categories(), [backend]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    const load = () => Promise.all([backend.bookings.list(session.token), backend.addresses.list(session.token), backend.notifications.list(session.token)])
      .then(([bookings, addresses, inbox]) => {
        if (alive) setExtra({ bookings, addresses, inbox });
      })
      .catch(() => undefined);
    void load();
    // Keep the live booking card moving while Home is open.
    const timer = setInterval(() => void load(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [backend, session.token]));

  const active = extra.bookings.find((b) => isActive(b.status));
  const home = extra.addresses[0];
  const unread = extra.inbox.filter((n) => !n.read).length;
  const area = home ? (home.street.split(',').map((x) => x.trim()).filter(Boolean).pop() ?? home.city) : null;
  const top = useQuery(() => backend.ai.topProblems(home?.pincode ?? null, area ? `${area}, ${home?.city ?? ''}` : null), [backend, home?.pincode, area, home?.city]);

  const openBell = () => {
    setBell(true);
    const ids = extra.inbox.filter((n) => !n.read).map((n) => n.id);
    if (ids.length > 0) {
      void backend.notifications.markRead(session.token, ids).catch(() => undefined);
      setExtra((e) => ({ ...e, inbox: e.inbox.map((n) => ({ ...n, read: true })) }));
    }
  };
  const first = session.customer.name.split(' ')[0] ?? '';

  const quickBook = (serviceId: string, issueId?: string) => {
    draft.start(serviceId, issueId);
    router.push('/book/problem');
  };

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
          <Tap onPress={openBell} style={styles.bell} accessibilityLabel={unread > 0 ? `${t('home.notifications')}, ${unread}` : t('home.notifications')} testID="home-bell">
            <Icon name="notifications-outline" size={22} color="ink" />
            {unread > 0 ? <View style={styles.badge} testID="home-bell-badge"><Txt variant="caption" color="onNavy">{unread > 9 ? '9+' : String(unread)}</Txt></View> : null}
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
          <View style={styles.searchMic}><Icon name="mic" size={18} color="blue" /></View>
        </Tap>

        {active ? (
          <Appear style={styles.block}>
            <SectionTitle title={t('home.active')} />
            <BookingCard booking={active} showProgress onPress={() => router.push(`/booking/${active.id}`)} />
          </Appear>
        ) : null}

        <Appear delay={60}>
          <Tap onPress={() => router.push('/book/snap')} testID="home-snap" accessibilityLabel={t('home.snap.title')} scale={0.98} haptic>
            <LinearGradient colors={['#2A3F8F', colors.navy]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
              <View style={styles.heroText}>
                <Pill label={t('home.snap.badge')} tone="demo" icon="sparkles" />
                <Txt variant="title2" color="onNavy">{t('home.snap.title')}</Txt>
                <Txt variant="footnote" color="onNavy" style={styles.heroSub}>{t('home.snap.body')}</Txt>
                <View style={styles.heroCta}>
                  <Icon name="camera" size={18} color="navy" />
                  <Txt variant="label" color="navy">{t('home.snap.cta')}</Txt>
                </View>
              </View>
              <View style={styles.heroArt}>
                <Art3D name="camera" size={92} float />
                <Art3D name="sparkles" size={38} style={styles.sparkle} />
              </View>
            </LinearGradient>
          </Tap>
        </Appear>

        <View style={styles.block}>
          <SectionTitle title={t('home.services')} action={t('home.viewAll')} onAction={() => router.push('/services')} />
          {cats.error ? <ErrorView error={cats.error} onRetry={cats.reload} title={t('catalog.loadError')} /> : null}
          <View style={styles.grid}>
            {cats.loading
              ? Array.from({ length: 6 }, (_, k) => <View key={k} style={styles.cell}><Skeleton style={styles.skelTile} /></View>)
              : (cats.data ?? []).map((c, k) => (
                  <Appear key={c.id} delay={80 + k * 40} style={styles.cell}>
                    <CategoryTile category={c} onPress={() => router.push(`/category/${c.id}`)} />
                  </Appear>
                ))}
          </View>
        </View>

        <View style={styles.block}>
          <View style={styles.topHead}>
            <View style={styles.flex}>
              <Txt variant="title3" heading>{t('home.topNear')}</Txt>
              <Txt variant="footnote" color="inkMuted" numberOfLines={1}>{top.data?.area ? t('home.topArea', { area: top.data.area }) : t('home.topCity')}</Txt>
            </View>
            <Pill label={t('home.topAi')} tone="demo" icon="sparkles" />
          </View>
          <View style={styles.problems}>
            {top.loading && !top.data
              ? Array.from({ length: 6 }, (_, k) => <Skeleton key={k} style={styles.problemSkel} />)
              : (top.data?.items ?? []).map((p, k) => {
                  const svc = serviceById(p.serviceId);
                  const issue = svc?.issues.find((x) => x.id === p.issueId);
                  const cat = svc ? categoryById(svc.categoryId) : undefined;
                  if (!svc || !issue || !cat) return null;
                  return (
                    <Appear key={p.issueId} delay={k * 50} style={styles.problemCell}>
                      <Tap onPress={() => quickBook(svc.id, issue.id)} style={styles.problem} accessibilityLabel={`${l(issue.name)}, ${t('home.topCount', { n: p.recentCount })}`} testID={`top-${p.issueId}`} haptic>
                        <Art3D name={cat.art} size={40} />
                        <View style={styles.shrink}>
                          <Txt variant="label" numberOfLines={2}>{l(issue.name)}</Txt>
                          <View style={styles.trend}>
                            <Icon name={k === 0 ? 'flame' : 'trending-up'} size={12} color={k === 0 ? 'orange' : 'inkMuted'} />
                            <Txt variant="caption" color="inkMuted">{t('home.topCount', { n: p.recentCount })}</Txt>
                          </View>
                        </View>
                      </Tap>
                    </Appear>
                  );
                })}
          </View>
        </View>
      </ScrollView>

      {/* keeps scrolled content from running under the status bar */}
      <View pointerEvents="none" style={[styles.scrim, { height: insets.top }]} />

      <Sheet visible={bell} onClose={() => setBell(false)} testID="notifications-sheet">
        <Txt variant="title2" heading>{t('home.notifications')}</Txt>
        <NotificationList items={extra.inbox} onOpen={(n) => {
          setBell(false);
          if (n.bookingId) router.push(`/booking/${n.bookingId}`);
        }} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  wash: { position: 'absolute', left: 0, right: 0, top: 0, height: 420 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(246,247,252,0.94)' },
  content: { paddingHorizontal: GUTTER, paddingBottom: space.x4, gap: space.lg },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  bell: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  location: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.8)', maxWidth: '100%' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingLeft: space.lg, paddingRight: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  searchMic: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  block: { gap: space.md },
  hero: { borderRadius: radius.xxl, flexDirection: 'row', overflow: 'hidden', minHeight: 170, ...shadow.raised },
  heroText: { flex: 1, padding: space.xl, paddingRight: 0, gap: space.sm, justifyContent: 'center' },
  heroSub: { opacity: 0.85 },
  heroCta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', backgroundColor: colors.yellow, minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, marginTop: space.xs },
  heroArt: { width: 120, alignItems: 'center', justifyContent: 'center' },
  sparkle: { position: 'absolute', top: 22, right: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.sm, rowGap: space.lg },
  cell: { width: '33.33%', paddingHorizontal: space.sm },
  skelTile: { width: '100%', aspectRatio: 1, borderRadius: radius.xl },
  topHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  problems: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm },
  problemCell: { width: '48.5%' },
  problemSkel: { width: '48.5%', height: 72, borderRadius: radius.lg },
  problem: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 72, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  badge: { position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
});
