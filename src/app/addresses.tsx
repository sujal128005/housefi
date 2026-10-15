// Saved addresses (from Account or the Home location chip).
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { PinArt } from '../illustrations/Scenes';
import { useI18n } from '../i18n/I18n';
import { useBackend, useQuery, useRefetchOnReturn } from '../services/ServicesProvider';
import { useSession } from '../state/AppState';
import { radius } from '../theme/tokens';
import { EmptyState, ErrorView, Header, Screen, Skeleton } from '../ui';
import { AddAddressCard, AddressCard } from '../ui/AddressCard';

export default function Addresses() {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const q = useQuery(() => backend.addresses.list(session.token), [backend, session.token]);
  const { reload } = q;
  useRefetchOnReturn(reload);
  const list = q.data ?? [];
  return (
    <Screen testID="addresses" header={<Header title={t('address.manage')} />}>
      {q.loading && !q.data ? <Skeleton style={styles.skel} /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} title={t('address.loadError')} /> : null}
      {q.data && list.length === 0 ? <EmptyState art={<PinArt size={120} />} title={t('address.empty')} /> : null}
      {list.map((a) => <AddressCard key={a.id} address={a} onEdit={() => router.push({ pathname: '/address/edit', params: { id: a.id } })} />)}
      <AddAddressCard label={t('address.add')} onPress={() => router.push('/address/edit')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  skel: { height: 110, borderRadius: radius.lg },
});
