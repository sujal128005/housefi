// Technician home: one clear next action. Online / offline switch, today's and total earnings, the current job (or
// "Waiting for new jobs" while online), today's jobs and the notification inbox. New offers open by themselves.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { serviceById } from '../../../data/catalog';
import { isActive } from '../../../domain/rules';
import type { Earnings, Job } from '../../../domain/types';
import { Art3D } from '../../../illustrations/Art3D';
import { formatRupees } from '../../../i18n/format';
import { useI18n, type StringKey } from '../../../i18n/I18n';
import { isApiError, type AppNotification } from '../../../services/api';
import { feedback } from '../../../services/feedback';
import { useBackend } from '../../../services/ServicesProvider';
import { useAppState, useTechSession } from '../../../state/AppState';
import { colors, GUTTER, radius, shadow, space } from '../../../theme/tokens';
import { Banner, DemoPill, ErrorBanner, Icon, SectionTitle, Sheet, Tap, Txt, Wash } from '../../../ui';
import { jobsText } from '../../../ui/present';
import { Appear, Pulse } from '../../../ui/motion';
import { NotificationList } from '../../../ui/Notifications';
import { JobCard, techStepIndex, TECH_STEPS } from '../../../ui/TechParts';
import { TechPhoto } from '../../../ui/TechIdentity';
import { keepIfSame, startPolling } from '../../../state/polling';

function greetingKey(h: number): StringKey {
  return h < 12 ? 'home.morning' : h < 17 ? 'home.afternoon' : 'home.evening';
}

/** The one thing to do next on the current job. */
function nextActionKey(j: Job): StringKey {
  switch (j.status) {
    case 'ASSIGNED': return 'tj.next.trip';
    case 'EN_ROUTE': return 'tj.next.arrive';
    case 'ARRIVED': return 'tj.next.code';
    case 'INSPECTING': return j.quote ? 'tj.next.checking' : 'tj.next.quote';
    case 'QUOTE_SHARED': return j.quote?.decision === 'REVISION_REQUESTED' ? 'tj.next.revise' : 'tj.next.waitApproval';
    case 'IN_PROGRESS': return j.workStarted ? 'tj.next.complete' : 'tj.next.startWork';
    case 'EXTRA_WORK': return 'tj.next.waitExtra';
    case 'PAYMENT_DUE': return j.finalPayment?.method === 'CASH' && j.finalPayment.state === 'PENDING' ? 'tj.next.cash' : 'tj.next.waitPay';
    default: return 'tj.next.open';
  }
}

export default function TechHome() {
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const { updateTech } = useAppState();
  const insets = useSafeAreaInsets();
  const p = session.profile;
  const [data, setData] = useState<{ jobs: readonly Job[]; earnings: Earnings | null; inbox: readonly AppNotification[] }>({ jobs: [], earnings: null, inbox: [] });
  const [bell, setBell] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    const load = () => Promise.all([backend.tech.jobs(session.token), backend.tech.earnings(session.token), backend.tech.notifications.list(session.token)])
      .then(([jobs, earnings, inbox]) => {
        if (alive) setData(keepIfSame<typeof data>({ jobs, earnings, inbox }));
      })
      .catch(() => undefined);
    // New offers come through TechAlerts; this keeps the job card and today's numbers current.
    const stop = startPolling(load, 5000);
    return () => {
      alive = false;
      stop();
    };
  }, [backend, session.token]));

  const active = data.jobs.find((j) => isActive(j.status));
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const today = data.jobs.filter((j) => j.acceptedAt >= dayStart);
  const unread = data.inbox.filter((n) => !n.read).length;
  const first = p.name.split(' ')[0] ?? '';

  const setOnline = async (online: boolean) => {
    setBusy(true);
    setError(null);
    try {
      updateTech(await backend.tech.setOnline(session.token, online));
      feedback(online ? 'success' : 'pop');
    } catch (e) {
      feedback('error');
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const practice = async () => {
    if (!backend.demo) return;
    setError(null);
    try {
      if (!p.online) updateTech(await backend.tech.setOnline(session.token, true));
      const offer = await backend.demo.practiceJob(session.token);
      feedback('offer');
      router.push(`/tech/offer/${offer.id}`);
    } catch (e) {
      feedback('error');
      setError(e);
    }
  };

  const openBell = () => {
    setBell(true);
    const ids = data.inbox.filter((n) => !n.read).map((n) => n.id);
    if (ids.length > 0) {
      void backend.tech.notifications.markRead(session.token, ids).catch(() => undefined);
      setData((d) => ({ ...d, inbox: d.inbox.map((n) => ({ ...n, read: true })) }));
    }
  };

  return (
    <View style={styles.root} testID="tech-home">
      <Wash name="festive" fade style={styles.wash} />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + space.md }]} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <TechPhoto photo={p.identity?.photo} gender={p.gender} size={48} />
          <View style={styles.flex}>
            <Txt variant="footnote" color="inkMuted">{t(greetingKey(new Date().getHours()))},</Txt>
            <Txt variant="title2" numberOfLines={1} testID="tech-home-name">{first} 👋</Txt>
          </View>
          <DemoPill />
          <Tap onPress={openBell} style={styles.bell} accessibilityLabel={t('home.notifications')} testID="tech-bell">
            <Icon name="notifications-outline" size={22} color="ink" />
            {unread > 0 ? <View style={styles.badge}><Txt variant="caption" color="onNavy">{unread > 9 ? '9+' : String(unread)}</Txt></View> : null}
          </Tap>
        </View>

        <View style={[styles.online, p.online ? styles.onlineOn : styles.onlineOff]} testID="tech-online-card">
          <View style={styles.onlineDot}>
            {p.online ? <Pulse size={44} color={colors.onLimeTint} /> : null}
            <View style={[styles.dot, { backgroundColor: p.online ? colors.onLimeTint : colors.inkSubtle }]} />
          </View>
          <View style={styles.flex}>
            <Txt variant="title3" color={p.online ? 'onLime' : 'ink'}>{p.online ? t('thome.online') : t('thome.offline')}</Txt>
            <Txt variant="footnote" color={p.online ? 'onLime' : 'inkMuted'} style={p.online ? styles.dim : undefined}>{p.online ? t('thome.onlineSub') : t('thome.offlineSub')}</Txt>
          </View>
          <Switch value={p.online} onValueChange={(v) => void setOnline(v)} disabled={busy} trackColor={{ true: colors.onLimeTint, false: colors.lineStrong }} thumbColor={colors.surface}
            accessibilityLabel={t('thome.availability')} testID="tech-online-switch" />
        </View>
        <ErrorBanner error={error && isApiError(error, 'CONFLICT') ? null : error} />
        {error && isApiError(error, 'CONFLICT') ? <Banner tone="info" text={t('thome.finishFirst')} /> : null}

        <View style={styles.money}>
          <Tap onPress={() => router.push('/tech/earnings')} style={[styles.moneyCard, styles.moneyToday]} accessibilityLabel={t('thome.today')} testID="tech-today">
            <Art3D name="money" size={40} />
            <Txt variant="caption" color="onNavy" style={styles.dim}>{t('thome.today')}</Txt>
            <Txt variant="title1" color="onNavy" testID="tech-today-amount">{formatRupees(data.earnings?.today ?? 0)}</Txt>
            <Txt variant="caption" color="onNavy" style={styles.dim}>{t('thome.jobsToday', { n: data.earnings?.jobsToday ?? 0 })}</Txt>
          </Tap>
          <Tap onPress={() => router.push('/tech/earnings')} style={styles.moneyCard} accessibilityLabel={t('thome.total')} testID="tech-total">
            <Art3D name="star" size={40} />
            <Txt variant="caption" color="inkMuted">{t('thome.total')}</Txt>
            <Txt variant="title1">{formatRupees(data.earnings?.total ?? 0)}</Txt>
            <Txt variant="caption" color="inkMuted">{p.rating ? `★ ${p.rating.toFixed(1)} · ${jobsText(p.jobsDone, t)}` : t('track.newTech')}</Txt>
          </Tap>
        </View>

        {active ? (
          <Appear>
            <Tap onPress={() => router.push(`/tech/job/${active.id}`)} style={styles.next} accessibilityLabel={t(nextActionKey(active))} testID="tech-next" haptic>
              <View style={styles.nextHead}>
                <Txt variant="caption" color="onNavy" style={styles.dim}>{t('thome.current')} · {active.code}</Txt>
                <Txt variant="caption" color="onNavy" style={styles.dim}>{t(TECH_STEPS[Math.max(0, Math.min(techStepIndex(active.status), 5))] ?? 'tj.step.done')}</Txt>
              </View>
              <Txt variant="title2" color="onNavy">{t(nextActionKey(active))}</Txt>
              <Txt variant="callout" color="onNavy" style={styles.dim}>{(serviceById(active.serviceId) ? l(serviceById(active.serviceId)!.name) : '')} · {active.customerName} · {active.address.street}</Txt>
              <View style={styles.nextCta}>
                <Txt variant="label" color="onLime">{t('thome.open')}</Txt>
                <Icon name="arrow-forward" size={18} color="onLime" />
              </View>
            </Tap>
          </Appear>
        ) : p.online ? (
          <View style={styles.waiting} testID="tech-waiting">
            <View style={styles.radar}>
              <Pulse size={170} color={colors.blue} />
              <Art3D name="bell" size={84} float />
            </View>
            <Txt variant="title3" align="center">{t('thome.waiting')}</Txt>
            <Txt variant="footnote" color="inkMuted" align="center">{t('thome.waitingSub', { area: p.areas.split(',')[0]?.trim() || p.city })}</Txt>
            {backend.demo ? (
              <Tap onPress={() => void practice()} style={styles.practice} accessibilityLabel={t('thome.practice')} testID="tech-practice">
                <Icon name="flask" size={16} color="demo" />
                <Txt variant="label" color="demo">{t('thome.practice')}</Txt>
              </Tap>
            ) : null}
          </View>
        ) : (
          <View style={styles.waiting} testID="tech-offline">
            <Art3D name="moon" size={90} float shadow />
            <Txt variant="title3" align="center">{t('thome.goOnline')}</Txt>
            <Txt variant="footnote" color="inkMuted" align="center">{t('thome.goOnlineSub')}</Txt>
          </View>
        )}

        <View style={styles.block}>
          <SectionTitle title={t('thome.todayJobs')} action={data.jobs.length > 0 ? t('home.viewAll') : undefined} onAction={() => router.push('/tech/jobs')} />
          {today.length === 0 ? <Txt variant="footnote" color="inkMuted">{t('thome.noJobsToday')}</Txt> : today.map((j) => (
            <JobCard key={j.id} job={j} onPress={() => router.push(`/tech/job/${j.id}`)} />
          ))}
        </View>
      </ScrollView>
      <View pointerEvents="none" style={[styles.scrim, { height: insets.top }]} />
      <Sheet visible={bell} onClose={() => setBell(false)} testID="tech-notifications">
        <Txt variant="title2" heading>{t('home.notifications')}</Txt>
        <NotificationList items={data.inbox} onOpen={(n) => {
          setBell(false);
          if (n.bookingId && data.jobs.some((j) => j.id === n.bookingId)) router.push(`/tech/job/${n.bookingId}`);
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
  dim: { opacity: 0.85 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  bell: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center', ...shadow.card },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  online: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xxl, ...shadow.card },
  onlineOn: { backgroundColor: colors.lime },
  onlineOff: { backgroundColor: colors.surface },
  onlineDot: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: colors.surface },
  money: { flexDirection: 'row', gap: space.md },
  moneyCard: { flex: 1, gap: 2, padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.surface, ...shadow.card },
  moneyToday: { backgroundColor: colors.navy, borderColor: colors.navy },
  next: { gap: space.sm, padding: space.xl, borderRadius: radius.xxl, backgroundColor: colors.navy, ...shadow.raised },
  nextHead: { flexDirection: 'row', justifyContent: 'space-between' },
  nextCta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', backgroundColor: colors.lime, minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, marginTop: space.xs },
  waiting: { alignItems: 'center', gap: space.sm, padding: space.lg, borderRadius: radius.xxl, backgroundColor: colors.surface, ...shadow.card },
  radar: { width: 180, height: 180, alignItems: 'center', justifyContent: 'center' },
  practice: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.demo, marginTop: space.xs },
  block: { gap: space.md },
});
