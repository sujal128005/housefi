import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isActive } from '../../domain/rules';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery, useRefetchOnReturn } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { GUTTER, radius, space } from '../../theme/tokens';
import { DemoPill, EmptyState, ErrorView, Screen, Segmented, Skeleton, Txt } from '../../ui';
import { BookingCard } from '../../ui/BookingCard';

type Tab = 'ACTIVE' | 'PAST';

export default function Bookings() {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const q = useQuery(() => backend.bookings.list(session.token), [backend, session.token]);
  const { reload } = q;
  useRefetchOnReturn(reload);
  const list = (q.data ?? []).filter((b) => (tab === 'ACTIVE' ? isActive(b.status) : !isActive(b.status)));

  return (
    <Screen
      testID="bookings"
      header={
        <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
          <View style={styles.titleRow}>
            <Txt variant="title1" heading style={styles.flex}>{t('bookings.title')}</Txt>
            <DemoPill />
          </View>
          <Segmented<Tab> value={tab} onChange={setTab} options={[{ value: 'ACTIVE', label: t('bookings.active') }, { value: 'PAST', label: t('bookings.past') }]} />
        </View>
      }
    >
      {q.loading && !q.data ? Array.from({ length: 2 }, (_, k) => <Skeleton key={k} style={styles.skel} />) : null}
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : null}
      {q.data && list.length === 0 ? (
        <EmptyState
          testID="bookings-empty"
          art={tab === 'ACTIVE' ? <Art3D name="calendar" size={120} float shadow /> : <Art3D name="package" size={120} float shadow />}
          title={tab === 'ACTIVE' ? t('bookings.emptyActive') : t('bookings.emptyPast')}
          body={t('bookings.emptyBody')}
          action={t('bookings.bookNow')}
          onAction={() => router.push('/services')}
        />
      ) : null}
      {list.map((b) => <BookingCard key={b.id} booking={b} onPress={() => router.push(`/booking/${b.id}`)} />)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: GUTTER, gap: space.md, paddingBottom: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  skel: { height: 110, borderRadius: radius.lg },
});
