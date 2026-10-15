// Add or edit an address. ?id=<id> edits; ?select=1 selects the new address for the booking in progress.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { validateAddress, type AddressErrors } from '../../domain/rules';
import type { AddressInput, AddressLabel } from '../../domain/types';
import { useI18n } from '../../i18n/I18n';
import { useBackend } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { colors, radius, space } from '../../theme/tokens';
import { Button, Chip, ConfirmSheet, ErrorBanner, Field, Header, Icon, NotInDemoSheet, Screen, Skeleton, Txt, useToast } from '../../ui';
import { LABEL_ICON } from '../../ui/AddressCard';

const EMPTY: AddressInput = { label: 'HOME', house: '', street: '', landmark: '', pincode: '' };
const LABELS: readonly AddressLabel[] = ['HOME', 'WORK', 'OTHER'];

export default function AddressEdit() {
  const { id, select } = useLocalSearchParams<{ id?: string; select?: string }>();
  const { t } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const { setAddress } = useDraft();
  const toast = useToast();
  const [form, setForm] = useState<AddressInput>(EMPTY);
  const [loading, setLoading] = useState(!!id);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [locationInfo, setLocationInfo] = useState(false);
  const street = useRef<TextInput>(null);
  const landmark = useRef<TextInput>(null);
  const pincode = useRef<TextInput>(null);

  useEffect(() => {
    if (!id) return;
    void backend.addresses.list(session.token).then((list) => {
      const a = list.find((x) => x.id === id);
      if (a) setForm({ label: a.label, house: a.house, street: a.street, landmark: a.landmark, pincode: a.pincode });
      setLoading(false);
    }, (e: unknown) => {
      setError(e);
      setLoading(false);
    });
  }, [id, backend, session.token]);

  const errors: AddressErrors = submitted ? validateAddress(form) : {};
  const set = (patch: Partial<AddressInput>) => setForm((f) => ({ ...f, ...patch }));
  const msg = (e: AddressErrors[keyof AddressErrors]) =>
    e === 'REQUIRED' ? t('address.required') : e === 'INVALID' ? t('address.pincodeInvalid') : e === 'OUTSIDE' ? t('address.outsideArea') : null;

  const save = async () => {
    setSubmitted(true);
    if (Object.keys(validateAddress(form)).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const saved = id ? await backend.addresses.update(session.token, id, form) : await backend.addresses.create(session.token, form);
      if (select === '1') setAddress(saved.id);
      router.back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await backend.addresses.remove(session.token, id);
      setConfirmDelete(false);
      toast.show(t('address.deleted'), 'trash');
      router.back();
    } catch (e) {
      setConfirmDelete(false);
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="address-edit"
      header={<Header title={id ? t('address.formEdit') : t('address.formNew')} />}
      footer={<Button label={t('address.save')} onPress={save} loading={busy} disabled={loading} testID="address-save" />}
    >
      {loading ? <><Skeleton style={styles.skel} /><Skeleton style={styles.skel} /></> : (
        <>
          <Button label={t('address.useLocation')} icon="locate" variant="secondary" size="md" tag={t('common.soon')} onPress={() => setLocationInfo(true)} testID="address-locate" />
          <View style={styles.block}>
            <Txt variant="label">{t('address.saveAs')}</Txt>
            <View style={styles.chips}>
              {LABELS.map((l) => (
                <Chip key={l} testID={`label-${l}`} label={t(`address.label.${l}`)} icon={LABEL_ICON[l]} selected={form.label === l} onPress={() => set({ label: l })} />
              ))}
            </View>
          </View>
          <Field testID="addr-house" label={t('address.house')} value={form.house} onChangeText={(v) => set({ house: v })} error={msg(errors.house)}
            returnKeyType="next" onSubmitEditing={() => street.current?.focus()} blurOnSubmit={false} maxLength={80} autoCapitalize="words" />
          <Field ref={street} testID="addr-street" label={t('address.street')} value={form.street} onChangeText={(v) => set({ street: v })} error={msg(errors.street)}
            returnKeyType="next" onSubmitEditing={() => landmark.current?.focus()} blurOnSubmit={false} maxLength={100} autoCapitalize="words" />
          <Field ref={landmark} testID="addr-landmark" label={t('address.landmark')} optional value={form.landmark} onChangeText={(v) => set({ landmark: v })}
            returnKeyType="next" onSubmitEditing={() => pincode.current?.focus()} blurOnSubmit={false} maxLength={80} autoCapitalize="words" />
          <View style={styles.cityRow}>
            <View style={styles.flex}>
              <Txt variant="label">{t('address.city')}</Txt>
              <View style={styles.city}>
                <Icon name="business-outline" size={18} color="inkMuted" />
                <Txt variant="callout" color="inkMuted">{t('address.cityDemo')}</Txt>
              </View>
            </View>
          </View>
          <Field ref={pincode} testID="addr-pincode" label={t('address.pincode')} value={form.pincode} onChangeText={(v) => set({ pincode: v.replace(/\D/g, '').slice(0, 6) })}
            keyboardType="number-pad" maxLength={6} error={msg(errors.pincode)} placeholder="500034" returnKeyType="done" onSubmitEditing={save} />
          <ErrorBanner error={error} />
          {id ? <Button label={t('address.delete')} icon="trash-outline" variant="danger" size="md" onPress={() => setConfirmDelete(true)} testID="address-delete" /> : null}
        </>
      )}
      <ConfirmSheet visible={confirmDelete} title={t('address.deleteConfirm')} icon="trash" confirmLabel={t('address.delete')} confirmVariant="danger"
        onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)} busy={busy} />
      <NotInDemoSheet visible={locationInfo} title={t('address.useLocation')} onClose={() => setLocationInfo(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: space.xs },
  block: { gap: space.sm },
  chips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  cityRow: { flexDirection: 'row' },
  city: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  skel: { height: 56, borderRadius: radius.md },
});
