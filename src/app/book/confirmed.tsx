// Booking request received. Honest wording: the request is placed and matching has started; no technician yet.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { serviceById } from '../../data/catalog';
import { CalendarCheckArt } from '../../illustrations/Scenes';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, ErrorView, Header, NotInDemoSheet, Screen, Skeleton, StatusPill, Txt } from '../../ui';
import { whenText } from '../../ui/present';

export default function Confirmed() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const q = useQuery(() => backend.bookings.get(session.token, id), [backend, session.token, id]);
  const [calendar, setCalendar] = useState(false);
  const { clear } = useDraft();
  const pop = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    clear();
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 10, bounciness: 12 }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop]);
  const b = q.data;
  const svc = b ? serviceById(b.serviceId) : undefined;

  return (
    <Screen
      testID="book-confirmed"
      wash="mint"
      header={<Header back={false} />}
      footer={
        <>
          <Button label={t('confirmed.track')} trailingIcon="arrow-forward" onPress={() => router.replace(`/booking/${id}`)} testID="confirmed-track" />
          <View style={styles.row}>
            <Button label={t('confirmed.calendar')} icon="calendar-outline" variant="outline" size="md" onPress={() => setCalendar(true)} style={styles.flex} />
            <Button label={t('confirmed.home')} icon="home-outline" variant="outline" size="md" onPress={() => router.back()} style={styles.flex} testID="confirmed-home" />
          </View>
        </>
      }
    >
      <Animated.View style={[styles.art, { transform: [{ scale: pop }] }]}><CalendarCheckArt size={190} /></Animated.View>
      <Txt variant="title1" align="center" heading>{t('confirmed.title')}</Txt>
      <Txt variant="body" color="inkMuted" align="center">{t('confirmed.body')}</Txt>
      <Banner tone="demo" text={t('confirmed.demo')} />
      {q.loading ? <Skeleton style={styles.skel} /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : null}
      {b ? (
        <Card style={styles.card}>
          <View style={styles.idRow}>
            <View style={styles.flex}>
              <Txt variant="caption" color="inkMuted">{t('confirmed.id')}</Txt>
              <Txt variant="title2" testID="booking-code" selectable>{b.code}</Txt>
            </View>
            <StatusPill status={b.status} />
          </View>
          <View style={styles.rule} />
          <Txt variant="bodyStrong">{svc ? l(svc.name) : ''}</Txt>
          <Txt variant="callout" color="inkMuted">{whenText(b.window, locale, t)}</Txt>
        </Card>
      ) : null}
      <NotInDemoSheet visible={calendar} title={t('confirmed.calendar')} onClose={() => setCalendar(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: space.sm },
  art: { alignItems: 'center', marginTop: space.md },
  card: { gap: space.xs },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: space.sm },
  skel: { height: 120, borderRadius: radius.lg },
});
