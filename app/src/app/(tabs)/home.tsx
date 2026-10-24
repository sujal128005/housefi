// Customer home: a soft header (greeting, location, a cobalt "Snap the problem" card with the AI, search), the live booking,
// the service categories and the AI-ranked top 6 problems in the customer's locality. The bell opens the inbox. On
// festival days (the server's calendar) the header dresses up in the festival's colours with a glowing banner and "Book
// now", and a strip shows the festival's coupon from Housefi HQ; the Housefi sign-off closes the page.
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
import { festiveLook } from '../../illustrations/FestiveArt';
import { useI18n, type StringKey } from '../../i18n/I18n';
import type { AppNotification } from '../../services/api';
import { useBackend, useIsDemo, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { BRAND_GRADIENT, colors, radius, shadow, space, washes } from '../../theme/tokens';
import { ErrorView, Icon, SectionTitle, Sheet, Skeleton, Tap, Txt } from '../../ui';
import { BookingCard } from '../../ui/BookingCard';
import { CategoryTile } from '../../ui/CategoryTile';
import { FestiveBackdrop, FestiveBanner, FestiveStrip, SignOff } from '../../ui/Festive';
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
  // The festival of the day (none on ordinary days); one that has just ended is not shown.
  const greet = useQuery(() => backend.catalog.greeting().then((g) => (g && g.until > Date.now() ? g : null)), [backend]);
  const festival = greet.data ?? null;

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

  const bookFestive = () => router.push(festival?.categoryId ? `/category/${festival.categoryId}` : '/services');

  const pad = { paddingHorizontal: layout.gutter };

  return (
    <View style={styles.root} testID="home">
      <Animated.ScrollView contentContainerStyle={{ paddingBottom: space.x4 }} showsVerticalScrollIndicator={false} scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}>
        {/* header: a soft lavender-pink wash with the cobalt hero card (the look of super.money's scan card) */}
        <LinearGradient colors={[...(festival ? festiveLook(festival.theme).wash : washes.festive), colors.canvas]} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
          style={[styles.hero, { paddingTop: insets.top + space.md }]}>
          {festival ? <FestiveBackdrop theme={festival.theme} /> : null}
          <View style={[styles.column, pad, styles.heroInner]}>
            <View style={styles.topRow}>
              <View style={styles.avatar}><Txt variant="title3" color="navy">{(first[0] ?? 'H').toUpperCase()}</Txt></View>
              <View style={styles.flex}>
                <Txt variant="footnote" color="inkMuted">{t(greetingKey(new Date().getHours()))},</Txt>
                <Txt variant="title2" numberOfLines={1} testID="home-name">{first}</Txt>
              </View>
              {isDemo ? <View style={styles.demoChip} accessibilityLabel="Demo mode"><Icon name="flask" size={12} color="demo" /><Txt variant="caption" color="demo">{t('common.demo')}</Txt></View> : null}
              <Tap onPress={openBell} style={styles.iconBtn} accessibilityLabel={unread > 0 ? `${t('home.notifications')}, ${unread}` : t('home.notifications')} testID="home-bell">
                <Icon name="notifications-outline" size={22} color="ink" />
                {unread > 0 ? <View style={styles.badge} testID="home-bell-badge"><Txt variant="caption" color="onNavy">{unread > 9 ? '9+' : String(unread)}</Txt></View> : null}
              </Tap>
            </View>

            <Tap onPress={() => router.push('/addresses')} style={styles.location} accessibilityLabel={home ? `${home.street}, ${home.city}` : t('home.addAddress')} testID="home-location">
              <Icon name="location" size={16} color="navy" />
              <Txt variant="label" numberOfLines={1} style={styles.shrink}>{home ? `${home.street}, ${home.city}` : t('home.addAddress')}</Txt>
              <Icon name="chevron-down" size={16} color="inkMuted" />
            </Tap>

            {festival ? <FestiveBanner greeting={festival} onBook={bookFestive} /> : null}

            <LinearGradient colors={BRAND_GRADIENT} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.snap}>
              <View style={[styles.blob, styles.blobA]} />
              <Tap onPress={() => router.push('/book/snap')} accessibilityLabel={t('home.snap.title')} scale={0.98} haptic style={styles.snapTop}>
                <View style={styles.viewfinder}>
                  {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <View key={c} style={[styles.corner, styles[c]]} />)}
                  <Art3D name="camera" size={layout.compact ? 58 : 68} float />
                </View>
                <View style={styles.snapText}>
                  <View style={styles.aiChip}><Icon name="sparkles" size={12} color="onLime" /><Txt variant="caption" color="onLime">{t('home.snap.badge')}</Txt></View>
                  <Txt variant="title3" color="onNavy">{t('home.snap.title')}</Txt>
                  <Txt variant="footnote" color="onNavyMuted">{t('home.snap.body')}</Txt>
                </View>
              </Tap>
              <View style={styles.glassRow}>
                <Tap onPress={() => router.push('/book/snap')} style={styles.glassBtn} haptic testID="home-snap" accessibilityLabel={t('home.snap.cta')}>
                  <Icon name="camera-outline" size={18} color="onNavy" />
                  <Txt variant="label" color="onNavy" numberOfLines={1}>{t('home.snap.cta')}</Txt>
                </Tap>
                <Tap onPress={() => router.push('/search')} style={styles.glassBtn} haptic testID="home-hero-search" accessibilityLabel={t('home.snap.speak')}>
                  <Icon name="mic-outline" size={18} color="onNavy" />
                  <Txt variant="label" color="onNavy" numberOfLines={1}>{t('home.snap.speak')}</Txt>
                </Tap>
              </View>
            </LinearGradient>

            <Tap onPress={() => router.push('/search')} style={styles.search} accessibilityRole="search" accessibilityLabel={t('home.search')} testID="home-search" scale={0.99}>
              <Icon name="search" size={20} color="inkMuted" />
              <Txt variant="callout" color="inkSubtle" style={styles.flex}>{t('home.search')}</Txt>
              <View style={styles.searchMic}><Icon name="mic" size={18} color="navy" /></View>
            </Tap>
          </View>
        </LinearGradient>

        <View style={[styles.column, pad, styles.body]}>
          {festival ? <FestiveStrip greeting={festival} onBook={bookFestive} style={[styles.strip, { marginHorizontal: -layout.gutter }]} /> : null}

          {active ? (
            <Appear style={styles.block}>
              <SectionTitle title={t('home.active')} />
              <BookingCard booking={active} showProgress onPress={() => router.push(`/booking/${active.id}`)} />
            </Appear>
          ) : null}

          <Tap onPress={() => router.push('/quote-check')} style={styles.qcCard} haptic testID="home-quote-check" accessibilityLabel={t('home.qc.title')}>
            <Art3D name="receipt" size={52} />
            <View style={styles.flex}>
              <Txt variant="bodyStrong">{t('home.qc.title')}</Txt>
              <Txt variant="footnote" color="inkMuted">{t('home.qc.body')}</Txt>
            </View>
            <Icon name="chevron-forward" size={18} color="inkSubtle" />
          </Tap>

          <Tap onPress={() => router.push('/society')} style={styles.qcCard} haptic testID="home-society" accessibilityLabel={t('home.soc.title')}>
            <Art3D name="house_garden" size={52} />
            <View style={styles.flex}>
              <Txt variant="bodyStrong">{t('home.soc.title')}</Txt>
              <Txt variant="footnote" color="inkMuted">{t('home.soc.body')}</Txt>
            </View>
            <Icon name="chevron-forward" size={18} color="inkSubtle" />
          </Tap>

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

          <SignOff audience="customer" />
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
  qcCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  root: { flex: 1, backgroundColor: colors.canvas },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.canvas, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  column: { width: '100%', maxWidth: MAX_CONTENT, alignSelf: 'center' },
  hero: { paddingBottom: space.md },
  heroInner: { gap: space.md },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: '#22D3FF' },
  blobA: { width: 220, height: 220, top: -120, right: -70, opacity: 0.28 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  demoChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.demoTint },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.75)', alignItems: 'center', justifyContent: 'center', ...shadow.card },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  location: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.7)', maxWidth: '100%' },
  snap: { borderRadius: radius.xxl, padding: space.lg, gap: space.lg, overflow: 'hidden', ...shadow.raised },
  snapTop: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  viewfinder: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: colors.lime },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
  snapText: { flex: 1, gap: space.xs },
  aiChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.lime },
  glassRow: { flexDirection: 'row', gap: space.sm },
  glassBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: 46, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingLeft: space.lg, paddingRight: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.blueTint, ...shadow.card },
  searchMic: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  body: { gap: space.xl, paddingTop: space.md },
  // Edge to edge, close to the search bar and the services below it.
  strip: { marginTop: -space.xs, marginBottom: -space.sm },
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
