// A technician's service area from India Post's directory: state → district → the localities they cover (several) →
// a PIN code that belongs to one of them. "Use my location" fills all four from where the phone is. The server checks
// the same rule (backend places.service.ts serviceArea).
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { isValidPincode } from '../domain/rules';
import { allowedPincodes, MAX_LOCALITIES } from '../domain/serviceArea';
import { useI18n } from '../i18n/I18n';
import { isApiError } from '../services/api';
import { locate } from '../services/device';
import { feedback } from '../services/feedback';
import { useBackend, useQuery } from '../services/ServicesProvider';
import { colors, radius, space } from '../theme/tokens';
import { Field } from './Field';
import { Icon } from './Icon';
import { SearchPicker } from './SearchPicker';
import { Tap } from './Tap';
import { Txt } from './Txt';

export interface AreaValue {
  readonly state: string | null;
  readonly district: string | null;
  readonly localities: readonly string[];
  readonly pincode: string;
}

export interface AreaProblems {
  readonly state: boolean;
  readonly district: boolean;
  readonly localities: boolean;
  /** FORMAT: not 6 digits; NOT_IN_AREA: not the PIN code of a chosen locality. */
  readonly pincode: 'FORMAT' | 'NOT_IN_AREA' | null;
}

/** The directory's lists for the current choice, and what is still missing or wrong. */
export function useServiceArea(value: AreaValue) {
  const backend = useBackend();
  const states = useQuery(() => backend.places.states(), [backend]);
  const districts = useQuery(() => (value.state ? backend.places.districts(value.state) : Promise.resolve([])), [backend, value.state]);
  const localities = useQuery(
    () => (value.state && value.district ? backend.places.localities(value.state, value.district) : Promise.resolve([])),
    [backend, value.state, value.district],
  );
  const pin = value.pincode.trim();
  // Until the localities have loaded the PIN code cannot be checked here: the server checks it anyway.
  const notInArea = isValidPincode(pin) && value.localities.length > 0 && !!localities.data && localities.data.length > 0
    && !allowedPincodes(localities.data, value.localities).has(pin);
  const problems: AreaProblems = {
    state: !value.state,
    district: !value.district,
    localities: value.localities.length === 0,
    pincode: !isValidPincode(pin) ? 'FORMAT' : notInArea ? 'NOT_IN_AREA' : null,
  };
  return { states, districts, localities, problems };
}

/** The fields; `area` is useServiceArea(value), shared with the screen that checks the form before sending it. */
export function ServiceAreaFields({ value, onChange, touched, area }: {
  readonly value: AreaValue;
  readonly onChange: (next: AreaValue) => void;
  readonly touched: boolean;
  readonly area: ReturnType<typeof useServiceArea>;
}) {
  const { t } = useI18n();
  const backend = useBackend();
  const { states, districts, localities, problems } = area;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ readonly ok: boolean; readonly text: string } | null>(null);
  const list = localities.data ?? [];
  const custom = value.localities.filter((c) => !list.some((p) => p.name.toLowerCase() === c.toLowerCase()));
  // The chosen localities' PIN codes, one tap to fill.
  const pinChoices: { readonly pin: string; readonly place: string }[] = [];
  for (const p of list) {
    if (!value.localities.includes(p.name)) continue;
    for (const pin of p.pincodes) if (pinChoices.length < 6 && !pinChoices.some((c) => c.pin === pin)) pinChoices.push({ pin, place: p.name });
  }

  const fill = async () => {
    setBusy(true);
    setNote(null);
    const r = await locate();
    if (!r.ok) {
      setBusy(false);
      feedback('warning');
      setNote({ ok: false, text: t(r.reason === 'DENIED' ? 'tsetup.locDenied' : r.reason === 'OFF' ? 'address.locOff' : 'tsetup.locNone') });
      return;
    }
    try {
      const { lat, lng, street, city, pincode } = r.place;
      const near = await backend.places.near(lat, lng, isValidPincode(pincode.trim()) ? pincode.trim() : undefined, [street, city].filter(Boolean).join(', '));
      const sameDistrict = value.state === near.state && value.district === near.district;
      const keep = sameDistrict ? value.localities.filter((l) => l !== near.locality) : [];
      onChange({ state: near.state, district: near.district, localities: [near.locality, ...keep].slice(0, MAX_LOCALITIES), pincode: near.pincode });
      feedback('success');
      setNote({ ok: true, text: t('tsetup.located', { place: `${near.locality}, ${near.district} · ${near.pincode}` }) });
    } catch (e) {
      feedback('warning');
      setNote({ ok: false, text: t(isApiError(e) && e.code === 'NETWORK' ? 'tsetup.locOffline' : 'tsetup.locNone') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap} testID="tsetup-area">
      <View style={styles.head}>
        <View style={styles.flex}>
          <Txt variant="title3" heading>{t('tsetup.area')}</Txt>
          <Txt variant="footnote" color="inkMuted">{t('tsetup.areaSub')}</Txt>
        </View>
      </View>
      <Tap onPress={() => void fill()} disabled={busy} style={styles.locate} accessibilityLabel={t('tsetup.locate')} testID="tsetup-locate" haptic>
        <View style={styles.locateIcon}>{busy ? <ActivityIndicator color={colors.onLime} /> : <Icon name="locate" size={20} color="onLime" />}</View>
        <View style={styles.flex}>
          <Txt variant="bodyStrong">{busy ? t('tsetup.locating') : t('tsetup.locate')}</Txt>
          <Txt variant="caption" color="inkMuted">{t('tsetup.locateSub')}</Txt>
        </View>
        <Icon name="chevron-forward" size={18} color="inkMuted" />
      </Tap>
      {note ? (
        <View style={[styles.note, note.ok ? styles.noteOk : styles.noteWarn]} accessibilityLiveRegion="polite" testID="tsetup-locate-note">
          <Icon name={note.ok ? 'checkmark-circle' : 'information-circle'} size={18} color={note.ok ? 'onLimeTint' : 'onWarningTint'} />
          <Txt variant="footnote" color={note.ok ? 'onLimeTint' : 'onWarningTint'} style={styles.flex}>{note.text}</Txt>
        </View>
      ) : null}

      <SearchPicker
        label={t('tsetup.state')} placeholder={t('tsetup.statePick')} testID="tsetup-state"
        options={(states.data ?? []).map((s) => ({ value: s }))} loading={states.loading}
        value={value.state} onChange={(state) => state !== value.state && onChange({ ...value, state, district: null, localities: [] })}
        loadFailed={!!states.error} onRetry={states.reload}
        // Without the list (no internet, or a server without the directory yet) the state can be typed in.
        onAdd={states.error ? (state) => onChange({ ...value, state, district: null, localities: [] }) : undefined}
        error={touched && problems.state ? t('address.required') : states.error ? t('tsetup.placesError') : null}
      />
      <SearchPicker
        label={t('tsetup.district')} placeholder={t('tsetup.districtPick')} testID="tsetup-district"
        options={(districts.data ?? []).map((d) => ({ value: d }))} loading={!!value.state && districts.loading}
        disabledHint={value.state ? null : t('tsetup.stateFirst')}
        value={value.district} onChange={(district) => district !== value.district && onChange({ ...value, district, localities: [] })}
        loadFailed={!!districts.error} onRetry={districts.reload}
        onAdd={districts.error ? (district) => onChange({ ...value, district, localities: [] }) : undefined}
        error={touched && problems.district && value.state ? t('address.required') : null}
      />
      <SearchPicker
        multiple max={MAX_LOCALITIES}
        label={t('tsetup.localities')} placeholder={t('tsetup.localitiesPick')} testID="tsetup-localities"
        options={[...custom.map((c) => ({ value: c, detail: t('tsetup.addedByYou') })), ...list.map((p) => ({ value: p.name, detail: p.pincodes.join(', ') }))]}
        loading={!!value.district && localities.loading}
        loadFailed={!!localities.error} onRetry={localities.reload}
        disabledHint={value.district ? null : t('tsetup.districtFirst')}
        value={value.localities} onChange={(next) => onChange({ ...value, localities: next })}
        onAdd={(name) => value.localities.length < MAX_LOCALITIES && onChange({ ...value, localities: [...value.localities, name] })}
        hint={t('tsetup.localitiesHint')}
        error={touched && problems.localities && value.district ? t('tsetup.areasErr') : null}
      />
      <Field
        label={t('address.pincode')} value={value.pincode} keyboardType="number-pad" maxLength={6} testID="tsetup-pincode"
        onChangeText={(v) => onChange({ ...value, pincode: v.replace(/\D/g, '').slice(0, 6) })}
        hint={t('tsetup.pinHint')}
        error={problems.pincode === 'NOT_IN_AREA' ? t('tsetup.pinNotInArea') : touched && problems.pincode === 'FORMAT' ? t('address.pincodeInvalid') : null}
      />
      {pinChoices.length > 0 && !pinChoices.some((c) => c.pin === value.pincode) ? (
        <View style={styles.pins}>
          <Txt variant="caption" color="inkMuted">{t('tsetup.pinSuggest')}</Txt>
          {pinChoices.map((c) => (
            <Tap key={c.pin} onPress={() => onChange({ ...value, pincode: c.pin })} style={styles.pin} accessibilityLabel={`${c.pin}, ${c.place}`} testID={`tsetup-pin-${c.pin}`}>
              <Txt variant="label" color="onBlueTint">{c.pin}</Txt>
              <Txt variant="caption" color="inkMuted" numberOfLines={1}>{c.place}</Txt>
            </Tap>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  locate: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingHorizontal: space.md, borderRadius: radius.lg, backgroundColor: colors.limeTint, borderWidth: 1.5, borderColor: '#D5F2B0' },
  locateIcon: { width: 40, height: 40, borderRadius: radius.icon, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: radius.md },
  noteOk: { backgroundColor: colors.limeTint },
  noteWarn: { backgroundColor: colors.warningTint },
  pins: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs, marginTop: -space.xs },
  pin: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.blueTint, maxWidth: '100%' },
});
