// Visit fee paid: the booking is confirmed and the search for a technician has started. Shows the booking ID and the
// arrival code to share at the door.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { serviceById } from '../../data/catalog';
import { Art3D } from '../../illustrations/Art3D';
import { formatRupees } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useIsDemo, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { radius, space } from '../../theme/tokens';
import { Banner, Button, Card, ErrorView, Header, Screen, Skeleton, StatusPill, Txt } from '../../ui';
import { ArrivalOtpCard } from '../../ui/BookingParts';
import { Appear, Celebrate } from '../../ui/motion';
import { visitTimeText } from '../../ui/present';
import { feedback } from '../../services/feedback';

export default function Confirmed() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  /** Labels about simulated backend outcomes show only with the demo backend. */
  const isDemo = useIsDemo();
  const session = useSession();
  const { clear } = useDraft();
  const art = Math.round(Math.min(150, useWindowDimensions().height * 0.15));
  const q = useQuery(() => backend.bookings.get(session.token, id), [backend, session.token, id]);
  const b = q.data;
  // "Confirmed" only once the backend says the visit fee is paid; anything else goes to the booking's live status.
  const paid = b?.visitPayment.state === 'PAID';
  const celebrated = useRef(false);
  useEffect(() => {
    if (!b) return;
    if (!paid) {
      router.replace(`/booking/${b.id}`);
      return;
    }
    if (celebrated.current) return;
    celebrated.current = true;
    clear();
    feedback('success');
  }, [b, paid, clear]);
  const svc = b ? serviceById(b.serviceId) : undefined;

  return (
    <Screen
      testID="book-confirmed"
      wash="mint"
      header={<Header back={false} />}
      footer={
        <>
          <Button label={t('confirmed.track')} trailingIcon="arrow-forward" variant="lime" onPress={() => router.replace(`/booking/${id}`)} testID="confirmed-track" />
          <Button label={t('confirmed.home')} variant="ghost" size="md" onPress={() => router.back()} testID="confirmed-home" />
        </>
      }
    >
      {paid ? (
        <>
          <View style={styles.art}>
            <Celebrate size={art}><Art3D name="check" size={art} shadow /></Celebrate>
          </View>
          <Appear>
            <Txt variant="title1" align="center" heading>{t('confirmed.title')}</Txt>
            <Txt variant="body" color="inkMuted" align="center">{t('confirmed.body')}</Txt>
          </Appear>
        </>
      ) : null}
      {q.loading ? <Skeleton style={styles.skel} /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : null}
      {b && paid ? (
        <Appear delay={150} style={styles.stack}>
          <Card style={styles.card}>
            <View style={styles.idRow}>
              <View style={styles.flex}>
                <Txt variant="caption" color="inkMuted">{t('confirmed.id')}</Txt>
                <Txt variant="title2" testID="booking-code" selectable>{b.code}</Txt>
              </View>
              <StatusPill status={b.status} />
            </View>
            <Txt variant="bodyStrong">{svc ? l(svc.name) : ''}</Txt>
            <Txt variant="callout" color="inkMuted">{visitTimeText(b.time, locale, t)}</Txt>
            <Txt variant="footnote" color="success">{t('confirmed.paid', { amount: formatRupees(b.visitPayment.amount) })}</Txt>
          </Card>
          <ArrivalOtpCard code={b.arrivalOtp} />
          {isDemo ? <Banner tone="demo" text={t('confirmed.demo')} /> : null}
        </Appear>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.md },
  art: { alignItems: 'center', justifyContent: 'center' },
  card: { gap: space.xs },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  skel: { height: 140, borderRadius: radius.lg },
});
