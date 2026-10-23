// Add or edit an address. ?id=<id> edits; ?select=1 selects the new address for the booking in progress;
// ?lat&lng&street&city&pincode pre-fill it from the phone's location.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { validateAddress, type AddressErrors } from '../../domain/rules';
import type { AddressInput, AddressLabel } from '../../domain/types';
import { useI18n } from '../../i18n/I18n';
import { locate } from '../../services/device';
import { useBackend } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { colors, space } from '../../theme/tokens';
import { Banner, Button, Chip, ConfirmSheet, ErrorBanner, Field, Header, Screen, Skeleton, Txt, useToast } from '../../ui';
import { LABEL_ICON } from '../../ui/AddressCard';
import { useSingleFlight } from '../../ui/useSingleFlight';

const EMPTY: AddressInput = { label: 'HOME', house: '', street: '', landmark: '', city: '', pincode: '' };
const LABELS: readonly AddressLabel[] = ['HOME', 'WORK', 'OTHER'];

type Params = { id?: string; select?: string; lat?: string; lng?: string; street?: string; city?: string; pincode?: string };

function fromParams(p: Params): AddressInput {
  const lat = p.lat ? Number(p.lat) : undefined;
  const lng = p.lng ? Number(p.lng) : undefined;
  const base = { ...EMPTY, street: p.street ?? '', city: p.city ?? '', pincode: (p.pincode ?? '').replace(/\D/g, '').slice(0, 6) };
  return lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng) ? { ...base, lat, lng } : base;
}

export default function AddressEdit() {
  const params = useLocalSearchParams<Params>();
  const { id, select } = params;
  const { t } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const { setAddress } = useDraft();
  const toast = useToast();
  const [form, setForm] = useState<AddressInput>(() => fromParams(params));
  const [loading, setLoading] = useState(!!id);
  const [locating, setLocating] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const street = useRef<TextInput>(null);
  const landmark = useRef<TextInput>(null);
  const city = useRef<TextInput>(null);
  const pincode = useRef<TextInput>(null);
  const fromGps = form.lat !== undefined;

  useEffect(() => {
    if (!id) return;
    void backend.addresses.list(session.token).then((list) => {
      const a = list.find((x) => x.id === id);
      if (a) {
        const { id: _id, ...input } = a;
        setForm(input);
      }
      setLoading(false);
    }, (e: unknown) => {
      setError(e);
      setLoading(false);
    });
  }, [id, backend, session.token]);

  // The PIN field's Done and the Save button: one save at a time, so a double Done never saves two copies.
  const once = useSingleFlight();
  const errors: AddressErrors = submitted ? validateAddress(form) : {};
  const set = (patch: Partial<AddressInput>) => setForm((f) => ({ ...f, ...patch }));
  const msg = (e: AddressErrors[keyof AddressErrors]) => (e === 'REQUIRED' ? t('address.required') : e === 'INVALID' ? t('address.pincodeInvalid') : null);

  const fillFromLocation = async () => {
    setLocating(true);
    const r = await locate();
    setLocating(false);
    if (!r.ok) return toast.show(t(r.reason === 'DENIED' ? 'address.locDenied' : r.reason === 'OFF' ? 'address.locOff' : 'address.locFailed'), 'location');
    const p = r.place;
    setForm((f) => ({ ...f, lat: p.lat, lng: p.lng, street: p.street || f.street, city: p.city || f.city, pincode: p.pincode.replace(/\D/g, '').slice(0, 6) || f.pincode }));
    toast.show(t('address.located'), 'location');
  };

  const save = () => once(async () => {
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
  });

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
          {fromGps ? (
            <Banner tone="success" icon="location" text={t('address.fromGps')} testID="address-gps-banner" />
          ) : (
            <Button label={t('address.useLocation')} icon="locate" variant="secondary" size="md" loading={locating} onPress={() => void fillFromLocation()} testID="address-form-locate" />
          )}
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
            returnKeyType="next" onSubmitEditing={() => landmark.current?.focus()} blurOnSubmit={false} maxLength={120} autoCapitalize="words" />
          <Field ref={landmark} testID="addr-landmark" label={t('address.landmark')} optional value={form.landmark} onChangeText={(v) => set({ landmark: v })}
            returnKeyType="next" onSubmitEditing={() => city.current?.focus()} blurOnSubmit={false} maxLength={80} autoCapitalize="words" />
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field ref={city} testID="addr-city" label={t('address.city')} value={form.city} onChangeText={(v) => set({ city: v })} error={msg(errors.city)}
                returnKeyType="next" onSubmitEditing={() => pincode.current?.focus()} blurOnSubmit={false} maxLength={40} autoCapitalize="words" />
            </View>
            <View style={styles.flex}>
              <Field ref={pincode} testID="addr-pincode" label={t('address.pincode')} value={form.pincode} onChangeText={(v) => set({ pincode: v.replace(/\D/g, '').slice(0, 6) })}
                keyboardType="number-pad" maxLength={6} error={msg(errors.pincode)} placeholder="500034" returnKeyType="done" onSubmitEditing={() => void save()} />
            </View>
          </View>
          <ErrorBanner error={error} />
          {locating ? <ActivityIndicator color={colors.blue} /> : null}
          {id ? <Button label={t('address.delete')} icon="trash-outline" variant="danger" size="md" onPress={() => setConfirmDelete(true)} testID="address-delete" /> : null}
        </>
      )}
      <ConfirmSheet visible={confirmDelete} title={t('address.deleteConfirm')} icon="trash" confirmLabel={t('address.delete')} confirmVariant="danger"
        onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  block: { gap: space.sm },
  chips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  skel: { height: 56, borderRadius: 14 },
});
