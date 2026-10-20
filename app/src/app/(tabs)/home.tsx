// Customer home: a cobalt header (greeting, location, search, and "Snap the problem" with the AI), the live booking,
// the service categories and the AI-ranked top 6 problems in the customer's locality. The bell opens the inbox.
// Adapts from small phones to tablets (columns and widths from ui/responsive).
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { categoryById, serviceById } from '../../data/catalog';
import { isActive } from '../../domain/rules';
import type { Address, Booking } from '../../domain/types';
import { Art3D, serviceArt } from '../../illustrations/Art3D';
import { useI18n, type StringKey } from '../../i18n/I18n';
import type { AppNotification } from '../../services/api';
import { useBackend, useIsDemo, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { BRAND_GRADIENT, colors, radius, shadow, space } from '../../theme/tokens';
import { ErrorView, Icon, SectionTitle, Sheet, Skeleton, Tap, Txt } from '../../ui';
import { BookingCard } from '../../ui/BookingCard';
import { CategoryTile } from '../../ui/CategoryTile';
import { Appear } from '../../ui/motion';
import { NotificationList } from '../../ui/Notifications';
import { MAX_CONTENT, useLayout } from '../../ui/responsive';
import { keepIfSame, startPolling } from '../../state/polling';

function greetingKey(h: number): StringKey {
  return h < 12 ? 'home.morning' : h < 17 ? 'home.afternoon' : 'home.evening';
}

export default function Home() {
  const { t, l } = useI18n();
  const backend = useBackend();
  const isDemo = useIsDemo();
  const session = useSession();
  const draft = useDraft();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [bell, setBell] = useState(false);
  // Behind the status bar: fades in once the blue header scrolls away, so content never runs under the clock.
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrim = scrollY.interpolate({ inputRange: [0, 48], outputRange: [0, 1], extrapolate: 'clamp' });
  const [extra, setExtra] = useState<{ bookings: readonly Booking[]; addresses: readonly Address[]; inbox: readonly AppNotification[] }>({ bookings: [], addresses: [], inbox: [] });
  const cats = useQuery(() => backend.catalog.categories(), [backend]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    const load = () => Promise.all([backend.bookings.list(session.token), backend.addresses.list(session.token), backend.notifications.list(session.token)])
      .then(([bookings, addresses, inbox]) => {
        if (alive) setExtra(keepIfSame<typeof extra>({ bookings, addresses, inbox }));
      })
      .catch(() => undefined);
    // Keep the live booking card moving while Home is open.
    const stop = startPolling(load, 5000);
    return () => {
      alive = false;
      stop();
    };
  }, [backend, session.token]));

  const active = extra.bookings.find((b) => isActive(b.status));
  const home = extra.addresses[0];
  const unread = extra.inbox.filter((n) => !n.read).length;
  const area = home ? (home.street.split(',').map((x) => x.trim()).filter(Boolean).pop() ?? home.city) : null;
  const top = useQuery(() => backend.ai.topProblems(session.token, home?.pincode ?? null, area ? `${area}, ${home?.city ?? ''}` : null), [backend, session.token, home?.pincode, area, home?.city]);
  const first = session.customer.name.split(' ')[0] ?? '';
  const cols = layout.columns(3);
  const problemCols = layout.tablet ? 3 : 2;

  const openBell = () => {
    setBell(true);
    const ids = extra.inbox.filter((n) => !n.read).map((n) => n.id);
    if (ids.length > 0) {
      void backend.notifications.markRead(session.token, ids).catch(() => undefined);
      setExtra((e) => ({ ...e, inbox: e.inbox.map((n) => ({ ...n, read: true })) }));
    }
  };

  const quickBook = (serviceId: string, issueId?: string) => {
    draft.start(serviceId, issueId);
    router.push('/book/problem');
  };

  const pad = { paddingHorizontal: layout.gutter };

  return (
    <View style={styles.root} testID="home">
      <Animated.ScrollView contentContainerStyle={{ paddingBottom: space.x4 }} showsVerticalScrollIndicator={false} scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}>
        {/* brand header */}
        <LinearGradient colors={BRAND_GRADIENT} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.hero, { paddingTop: insets.top + space.md }]}>
          <View style={[styles.blob, styles.blobA]} />
          <View style={[styles.blob, styles.blobB]} />
          <View style={[styles.column, pad, styles.heroInner]}>
            <View style={styles.topRow}>
              <View style={styles.avatar}><Txt variant="title3" color="navy">{(first[0] ?? 'H').toUpperCase()}</Txt></View>
              <View style={styles.flex}>
                <Txt variant="footnote" color="onNavyMuted">{t(greetingKey(new Date().getHours()))},</Txt>
                <Txt variant="title2" color="onNavy" numberOfLines={1} testID="home-name">{first}</Txt>
              </View>
              {isDemo ? <View style={styles.demoChip} accessibilityLabel="Demo mode"><Icon name="flask" size={12} color="onNavy" /><Txt variant="caption" color="onNavy">{t('common.demo')}</Txt></View> : null}
              <Tap onPress={openBell} style={styles.glassBtn} accessibilityLabel={unread > 0 ? `${t('home.notifications')}, ${unread}` : t('home.notifications')} testID="home-bell">
                <Icon name="notifications-outline" size={22} color="onNavy" />
                {unread > 0 ? <View style={styles.badge} testID="home-bell-badge"><Txt variant="caption" color="onNavy">{unread > 9 ? '9+' : String(unread)}</Txt></View> : null}
              </Tap>
            </View>

            <Tap onPress={() => router.push('/addresses')} style={styles.location} accessibilityLabel={home ? `${home.street}, ${home.city}` : t('home.addAddress')} testID="home-location">
              <Icon name="location" size={16} color="amber" />
              <Txt variant="label" color="onNavy" numberOfLines={1} style={styles.shrink}>{home ? `${home.street}, ${home.city}` : t('home.addAddress')}</Txt>
              <Icon name="chevron-down" size={16} color="onNavyMuted" />
            </Tap>

            <Tap onPress={() => router.push('/search')} style={styles.search} accessibilityRole="search" accessibilityLabel={t('home.search')} testID="home-search" scale={0.99}>
              <Icon name="search" size={20} color="inkMuted" />
              <Txt variant="callout" color="inkSubtle" style={styles.flex}>{t('home.search')}</Txt>
              <View style={styles.searchMic}><Icon name="mic" size={18} color="navy" /></View>
            </Tap>

            <Tap onPress={() => router.push('/book/snap')} testID="home-snap" accessibilityLabel={t('home.snap.title')} scale={0.98} haptic style={styles.snap}>
              <View style={styles.snapText}>
                <View style={styles.aiChip}><Icon name="sparkles" size={12} color="onAmber" /><Txt variant="caption" color="onAmber">{t('home.snap.badge')}</Txt></View>
                <Txt variant="title2" color="onNavy">{t('home.snap.title')}</Txt>
                <Txt variant="footnote" color="onNavyMuted">{t('home.snap.body')}</Txt>
                <View style={styles.snapCta}>
                  <Icon name="camera" size={18} color="onAmber" />
                  <Txt variant="label" color="onAmber">{t('home.snap.cta')}</Txt>
                </View>
              </View>
              <Art3D name="camera" size={layout.compact ? 84 : 104} float />
            </Tap>
          </View>
        </LinearGradient>

        <View style={[styles.column, pad, styles.body]}>
          {active ? (
            <Appear style={styles.block}>
              <SectionTitle title={t('home.active')} />
              <BookingCard booking={active} showProgress onPress={() => router.push(`/booking/${active.id}`)} />
            </Appear>
          ) : null}

          <View style={styles.block}>
            <SectionTitle title={t('home.services')} action={t('home.viewAll')} onAction={() => router.push('/services')} />
            {cats.error ? <ErrorView error={cats.error} onRetry={cats.reload} title={t('catalog.loadError')} /> : null}
            <View style={styles.grid}>
              {cats.loading
                ? Array.from({ length: 6 }, (_, k) => <View key={k} style={[styles.cell, { width: `${100 / cols}%` }]}><Skeleton style={styles.skelTile} /></View>)
                : (cats.data ?? []).map((c, k) => (
                    <Appear key={c.id} delay={60 + k * 40} style={[styles.cell, { width: `${100 / cols}%` }]}>
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
              <View style={styles.aiPill}><Icon name="sparkles" size={12} color="navy" /><Txt variant="caption" color="navy">{t('home.topAi')}</Txt></View>
            </View>
            <View style={styles.problems}>
              {top.loading && !top.data
                ? Array.from({ length: 6 }, (_, k) => <Skeleton key={k} style={[styles.problemSkel, { width: `${100 / problemCols - 2}%` }]} />)
                : (top.data?.items ?? []).map((p, k) => {
                    const svc = serviceById(p.serviceId);
                    const issue = svc?.issues.find((x) => x.id === p.issueId);
                    const cat = svc ? categoryById(svc.categoryId) : undefined;
                    if (!svc || !issue || !cat) return null;
                    return (
                      <Appear key={p.issueId} delay={k * 50} style={{ width: `${100 / problemCols - 2}%` }}>
                        <Tap onPress={() => quickBook(svc.id, issue.id)} style={styles.problem} accessibilityLabel={`${l(issue.name)}, ${t('home.topCount', { n: p.recentCount })}`} testID={`top-${p.issueId}`} haptic>
                          <Art3D name={serviceArt(svc.id, cat.art)} size={44} />
                          <View style={styles.shrink}>
                            <Txt variant="label" numberOfLines={2}>{l(issue.name)}</Txt>
                            <View style={styles.trend}>
                              <Icon name={k === 0 ? 'flame' : 'trending-up'} size={12} color={k === 0 ? 'orange' : 'success'} />
                              <Txt variant="caption" color="inkMuted">{t('home.topCount', { n: p.recentCount })}</Txt>
                            </View>
                          </View>
                        </Tap>
                      </Appear>
                    );
                  })}
            </View>
          </View>
        </View>
      </Animated.ScrollView>
      <Animated.View pointerEvents="none" style={[styles.scrim, { height: insets.top, opacity: scrim }]} />

      <Sheet visible={bell} onClose={() => setBell(false)} testID="notifications-sheet">
        <Txt variant="title2" heading>{t('home.notifications')}</Txt>
        <NotificationList items={extra.inbox} onOpen={(n) => {
          setBell(false);
          if (n.kind === 'SUPPORT_REPLY') router.push('/support');
          else if (n.bookingId) router.push(`/booking/${n.bookingId}`);
        }} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.canvas, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  column: { width: '100%', maxWidth: MAX_CONTENT, alignSelf: 'center' },
  hero: { borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden', paddingBottom: space.xl },
  heroInner: { gap: space.md },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: '#22D3FF' },
  blobA: { width: 260, height: 260, top: -110, right: -80, opacity: 0.3 },
  blobB: { width: 200, height: 200, bottom: -90, left: -70, opacity: 0.18 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center' },
  demoChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine },
  glassBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#0A3CF5' },
  location: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.glass, maxWidth: '100%' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 54, paddingLeft: space.lg, paddingRight: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  searchMic: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  snap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg, borderRadius: radius.xxl, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine },
  snapText: { flex: 1, gap: space.xs },
  aiChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.amber },
  snapCta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', backgroundColor: colors.amber, minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, marginTop: space.sm },
  body: { gap: space.xl, paddingTop: space.xl },
  block: { gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs, rowGap: space.md },
  cell: { paddingHorizontal: space.xs },
  skelTile: { width: '100%', aspectRatio: 0.95, borderRadius: radius.xl },
  topHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  aiPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.blueTint },
  problems: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm },
  problemSkel: { height: 76, borderRadius: radius.lg },
  problem: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 76, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
});
