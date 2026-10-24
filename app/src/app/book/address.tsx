// Step 2 of 4: use the current location, pick a saved address, or add a new one.
import { Redirect, router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Art3D } from '../../illustrations/Art3D';
import { LocateCard } from '../../ui/LocateCard';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery, useRefetchOnReturn } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { radius, space } from '../../theme/tokens';
import { Button, ErrorView, Screen, Skeleton, Txt } from '../../ui';
import { AddAddressCard, AddressCard } from '../../ui/AddressCard';
import { StepHeader } from '../../ui/StepHeader';

export default function AddressStep() {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const { draft, setAddress } = useDraft();
  const q = useQuery(() => backend.addresses.list(session.token), [backend, session.token]);
  const { reload } = q;
  const list = q.data ?? [];

  useRefetchOnReturn(reload);

  // Keep a valid selection: the chosen one if it still exists, else the first.
  useEffect(() => {
    if (!q.data) return;
    if (!q.data.some((a) => a.id === draft.addressId)) setAddress(q.data[0]?.id ?? null);
  }, [q.data, draft.addressId, setAddress]);

  if (!draft.serviceId) return <Redirect href="/home" />;
  const chosen = list.some((a) => a.id === draft.addressId);

  return (
    <Screen
      testID="book-address"
      header={<StepHeader step={2} />}
      footer={<Button label={t('address.use')} trailingIcon="arrow-forward" disabled={!chosen} onPress={() => router.push(draft.society ? '/book/confirm' : '/book/when')} testID="address-next" />}
    >
      <View style={styles.head}>
        <View style={styles.flex}>
          <Txt variant="title1" heading>{t('address.title')}</Txt>
        </View>
        <Art3D name="pin" size={72} float />
      </View>
      <LocateCard select />
      {q.loading && !q.data ? <><Skeleton style={styles.skel} /><Skeleton style={styles.skel} /></> : null}
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} title={t('address.loadError')} /> : null}
      {q.data && list.length === 0 ? <Txt variant="callout" color="inkMuted">{t('address.empty')}</Txt> : null}
      {list.length > 0 ? <Txt variant="caption" color="inkMuted">{t('address.saved')}</Txt> : null}
      {list.map((a) => (
        <AddressCard key={a.id} address={a} selected={a.id === draft.addressId} onPress={() => setAddress(a.id)}
          onEdit={() => router.push({ pathname: '/address/edit', params: { id: a.id } })} />
      ))}
      <AddAddressCard label={t('address.add')} onPress={() => router.push({ pathname: '/address/edit', params: { select: '1' } })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  skel: { height: 110, borderRadius: radius.lg },
});
