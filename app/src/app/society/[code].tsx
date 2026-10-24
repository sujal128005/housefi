// One society repair day: what, when, how many flats have joined, the lower visit fee, sharing the code, and booking
// the customer's own flat (the normal booking steps, with the day's window and fee).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { categoryById, servicesIn } from '../../data/catalog';
import { parseIsoDate } from '../../domain/rules';
import { Art3D } from '../../illustrations/Art3D';
import { formatClock, formatDate, formatRupees, formatWindow } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { isApiError } from '../../services/api';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, EmptyState, ErrorView, Header, Pill, Screen, Sheet, Skeleton, Tap, Txt, useToast } from '../../ui';
import { CategoryBadge } from '../../ui/CategoryTile';

export default function SocietyDayScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const draft = useDraft();
  const toast = useToast();
  const q = useQuery(() => backend.bookings.society(session.token, code ?? ''), [backend, session.token, code]);
  const [picking, setPicking] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const d = q.data;

  if (!d) {
    return (
      <Screen testID="society-day" header={<Header title={t('soc.title')} />}>
        {q.error && isApiError(q.error, 'NOT_FOUND') ? <EmptyState art={<Art3D name="no_results" size={110} />} title={t('soc.notFound')} testID="soc-not-found" /> : null}
        {q.error && !isApiError(q.error, 'NOT_FOUND') ? <ErrorView error={q.error} onRetry={q.reload} /> : null}
        {!q.error ? <Skeleton style={styles.skel} /> : null}
      </Screen>
    );
  }

  const cat = categoryById(d.categoryId);
  const when = `${formatDate(parseIsoDate(d.time.window.date), locale)} · ${formatWindow(d.time.window.startHour, d.time.window.endHour, locale)}`;
  const cutoff = new Date(d.cutoffAt);
  const canJoin = d.state === 'OPEN' && openedAt < d.cutoffAt && !d.myBookingId && d.joined < d.maxFlats;
  const share = async () => {
    try {
      await Share.share({ message: t('soc.shareText', { name: d.name, when, code: d.code, fee: formatRupees(d.visitFee) }) });
    } catch {
      toast.show(t('safety.shareFailed'), 'share-social');
    }
  };
  const book = (serviceId: string) => {
    setPicking(false);
    draft.startSociety({ serviceId, code: d.code, name: d.name, visitFee: d.visitFee, window: d.time.window });
    router.push('/book/problem');
  };

  return (
    <Screen testID="society-day" wash="sky" header={<Header title={t('soc.title')} />}
      footer={d.myBookingId ? (
        <Button label={t('soc.myFlat')} trailingIcon="arrow-forward" onPress={() => router.push(`/booking/${d.myBookingId}`)} testID="soc-my-flat" />
      ) : canJoin ? (
        <Button label={t('soc.bookFlat', { fee: formatRupees(d.visitFee) })} icon="home" onPress={() => setPicking(true)} testID="soc-book" />
      ) : undefined}>
      <Card style={styles.card} testID="soc-card">
        <View style={styles.row}>
          {cat ? <CategoryBadge category={cat} size={56} /> : null}
          <View style={styles.flex}>
            <Txt variant="title2">{d.name}</Txt>
            <Txt variant="footnote" color="inkMuted">{d.area.locality ? `${d.area.locality}, ` : ''}{d.area.city} {d.area.pincode}</Txt>
          </View>
          <Pill tone={d.state === 'CANCELLED' ? 'neutral' : d.state === 'OPEN' ? 'info' : 'success'} label={t(`soc.state.${d.state}`)} />
        </View>
        <Txt variant="bodyStrong">{cat ? l(cat.name) : ''} · {when}</Txt>
        <View style={styles.row}>
          <Txt variant="label" style={styles.flex}>{t('soc.flats', { n: d.flats, min: d.minFlats })}</Txt>
          <Txt variant="caption" color="inkMuted">{t('soc.joinedN', { n: d.joined })}</Txt>
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, (d.flats / d.minFlats) * 100)}%` }]} /></View>
        <View style={styles.row}>
          <Txt variant="callout" style={styles.flex}>{t('soc.feeEach')}</Txt>
          <Txt variant="caption" color="inkMuted" style={styles.strike}>{formatRupees(d.usualVisitFee)}</Txt>
          <Txt variant="title3" color="success">{formatRupees(d.visitFee)}</Txt>
        </View>
      </Card>

      {d.state === 'OPEN' ? <Banner tone="info" icon="time-outline" text={t('soc.openNote', { min: d.minFlats, time: `${formatDate(cutoff, locale)} ${formatClock(cutoff, locale)}` })} testID="soc-open-note" /> : null}
      {d.state === 'CONFIRMED' ? <Banner tone="success" icon="checkmark-circle" text={t('soc.confirmedNote')} /> : null}
      {d.state === 'ASSIGNED' && d.technician ? <Banner tone="success" icon="person" text={t('soc.assignedNote', { name: d.technician.name })} testID="soc-assigned" /> : null}
      {d.state === 'CANCELLED' ? <Banner tone="warning" icon="close-circle" text={t('soc.cancelledNote')} /> : null}

      {d.state === 'OPEN' ? (
        <Card style={styles.card}>
          <Txt variant="bodyStrong">{t('soc.shareTitle')}</Txt>
          <Txt variant="hero" align="center" lang="en" style={styles.code} testID="soc-code-shown" selectable>{d.code}</Txt>
          <Button label={t('soc.share')} icon="share-social" variant="secondary" onPress={() => void share()} testID="soc-share" />
        </Card>
      ) : null}
      <Txt variant="footnote" color="inkMuted">{t('soc.howItWorks', { min: d.minFlats })}</Txt>

      <Sheet visible={picking} onClose={() => setPicking(false)} testID="soc-service-sheet">
        <Txt variant="title3" heading>{t('soc.whatFix')}</Txt>
        {servicesIn(d.categoryId).map((s) => (
          <Tap key={s.id} onPress={() => book(s.id)} style={styles.svc} testID={`soc-svc-${s.id}`} accessibilityLabel={l(s.name)}>
            {cat ? <CategoryBadge category={cat} serviceId={s.id} size={40} /> : null}
            <Txt variant="body" style={styles.flex}>{l(s.name)}</Txt>
          </Tap>
        ))}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  skel: { height: 300, borderRadius: radius.xxl },
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  track: { height: 10, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.success },
  strike: { textDecorationLine: 'line-through' },
  code: { letterSpacing: 6 },
  svc: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
});
