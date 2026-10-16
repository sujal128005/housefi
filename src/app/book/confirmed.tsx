// Visit fee paid: the booking is confirmed and the search for a technician has started. Shows the booking ID and the
// arrival code to share at the door.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { serviceById } from '../../data/catalog';
import { Art3D } from '../../illustrations/Art3D';
import { formatRupees } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { radius, space } from '../../theme/tokens';
import { Banner, Button, Card, ErrorView, Header, Screen, Skeleton, StatusPill, Txt } from '../../ui';
import { ArrivalOtpCard } from '../../ui/BookingParts';
import { Appear, Pop } from '../../ui/motion';
import { visitTimeText } from '../../ui/present';
import { feedback } from '../../services/feedback';

export default function Confirmed() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const { clear } = useDraft();
  const art = Math.round(Math.min(150, useWindowDimensions().height * 0.15));
  const q = useQuery(() => backend.bookings.get(session.token, id), [backend, session.token, id]);
  useEffect(() => {
    clear();
    feedback('success');
  }, [clear]);
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
          <Button label={t('confirmed.home')} variant="ghost" size="md" onPress={() => router.back()} testID="confirmed-home" />
        </>
      }
    >
      <View style={styles.art}>
        <Pop><Art3D name="check" size={art} shadow /></Pop>
        <Art3D name="party" size={art * 0.45} style={styles.party} />
      </View>
      <Appear>
        <Txt variant="title1" align="center" heading>{t('confirmed.title')}</Txt>
        <Txt variant="body" color="inkMuted" align="center">{t('confirmed.body')}</Txt>
      </Appear>
      {q.loading ? <Skeleton style={styles.skel} /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : null}
      {b ? (
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
          <Banner tone="demo" text={t('confirmed.demo')} />
        </Appear>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.md },
  art: { alignItems: 'center', justifyContent: 'center' },
  party: { position: 'absolute', top: 0, right: '22%' },
  card: { gap: space.xs },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  skel: { height: 140, borderRadius: radius.lg },
});
