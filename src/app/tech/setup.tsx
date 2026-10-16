// Technician profile: profile photo (required), full legal name, gender, experience, skills, service area and vehicle.
// Submitting sends it for verification (Pending -> Approved / Needs correction). Also used to fix or edit the profile
// (?edit=1): after the first submission the photo and legal name are shown read-only (support corrects them).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CATEGORIES } from '../../data/catalog';
import { isValidName, isValidPincode } from '../../domain/rules';
import type { CategoryId, Gender } from '../../domain/types';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n } from '../../i18n/I18n';
import { resetTo } from '../../navigation';
import { pickProfilePhoto } from '../../services/device';
import { feedback } from '../../services/feedback';
import { useBackend } from '../../services/ServicesProvider';
import { useAppState, useTechSession } from '../../state/AppState';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Chip, ErrorBanner, Field, Header, Icon, Pill, Screen, Tap, Txt, Wash } from '../../ui';
import { TechPhoto } from '../../ui/TechIdentity';

export default function TechSetup() {
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const { updateTech } = useAppState();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const p = session.profile;
  /** Identity is fixed after the first submission. */
  const locked = p.identity !== null;
  const [photo, setPhoto] = useState<string | null>(p.identity?.photo ?? null);
  const [photoIssue, setPhotoIssue] = useState<'DENIED' | 'UNAVAILABLE' | null>(null);
  const [name, setName] = useState(p.name);
  const [gender, setGender] = useState<Gender | null>(p.verification ? p.gender : null);
  const [years, setYears] = useState(p.experienceYears);
  const [skills, setSkills] = useState<readonly CategoryId[]>(p.skills);
  const [city, setCity] = useState(p.city);
  const [pincode, setPincode] = useState(p.pincode);
  const [areas, setAreas] = useState(p.areas);
  const [vehicle, setVehicle] = useState(p.vehicle);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const problems = {
    photo: !locked && !photo,
    name: !isValidName(name),
    gender: gender === null,
    skills: skills.length === 0,
    city: city.trim().length < 2,
    pincode: !isValidPincode(pincode.trim()),
    areas: areas.trim().length < 2,
  };
  const ok = !Object.values(problems).some(Boolean);

  const takePhoto = async (source: 'camera' | 'gallery') => {
    setPhotoIssue(null);
    const r = await pickProfilePhoto(source);
    if (r.ok) {
      setPhoto(r.photo);
      feedback('pop');
    } else if (r.reason !== 'CANCELLED') {
      setPhotoIssue(r.reason);
      feedback('warning');
    }
  };

  const toggle = (id: CategoryId) => {
    feedback('select');
    setSkills((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const submit = async () => {
    setTouched(true);
    if (!ok || !gender) {
      feedback('warning');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const profile = await backend.tech.submitProfile(session.token, {
        name: locked ? (p.identity?.legalName ?? name) : name, gender, experienceYears: years, skills, city, pincode, areas, vehicle,
        photo: locked ? undefined : (photo ?? undefined),
      });
      updateTech(profile);
      feedback('send');
      resetTo('/tech/verification');
    } catch (e) {
      feedback('error');
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="tech-setup"
      wash="peach"
      header={<Header back={edit === '1' || router.canGoBack()} title={t('tsetup.title')} />}
      footer={<Button label={t('tsetup.submit')} icon="shield-checkmark" onPress={() => void submit()} loading={busy} testID="tsetup-submit" />}
    >
      <View style={styles.hero}>
        <Art3D name="tech_hero" size={110} float shadow badge="toolbox" />
        <View style={styles.flex}>
          <Txt variant="title2" heading>{t('tsetup.heading')}</Txt>
          <Txt variant="callout" color="inkMuted">{t('tsetup.body')}</Txt>
        </View>
      </View>
      {p.correctionNote ? <Banner tone="warning" icon="alert-circle" text={l(p.correctionNote)} testID="tsetup-correction" /> : null}
      {p.verification === 'APPROVED' ? <Banner tone="info" text={t('tsetup.reverify')} /> : null}

      {/* identity: photo and legal name (fixed once submitted) */}
      <View style={styles.block}>
        <Txt variant="label">{t('tsetup.photo')}</Txt>
        <View style={styles.photoRow}>
          {photo ? <TechPhoto photo={photo} gender={gender ?? 'M'} size={96} /> : (
            <View style={[styles.photoEmpty, touched && problems.photo && styles.photoMissing]} testID="tsetup-photo-empty">
              <Icon name="person" size={40} color="inkSubtle" />
            </View>
          )}
          <View style={styles.flex}>
            {locked ? (
              <View style={styles.lockRow}><Icon name="lock-closed" size={14} color="inkMuted" /><Txt variant="footnote" color="inkMuted" style={styles.flex}>{t('tsetup.locked')}</Txt></View>
            ) : (
              <>
                <Txt variant="footnote" color="inkMuted">{t('tsetup.photoHint')}</Txt>
                <View style={styles.photoBtns}>
                  <Button label={t('tsetup.photoTake')} icon="camera" size="sm" variant="secondary" onPress={() => void takePhoto('camera')} testID="tsetup-photo-camera" />
                  <Button label={t('tsetup.photoUpload')} icon="image" size="sm" variant="secondary" onPress={() => void takePhoto('gallery')} testID="tsetup-photo-upload" />
                </View>
              </>
            )}
          </View>
        </View>
        {!locked && backend.demo ? (
          <Tap onPress={() => {
            setPhoto(gender === 'F' ? 'demo:tech_woman' : 'demo:tech_man');
            setPhotoIssue(null);
            feedback('select');
          }} style={styles.sample} accessibilityRole="button" testID="tsetup-photo-sample">
            <Icon name="flask" size={14} color="demo" />
            <Txt variant="label" color="demo">{t('tsetup.photoSample')}</Txt>
          </Tap>
        ) : null}
        {photo?.startsWith('demo:') ? <Txt variant="caption" color="demo">{t('id.sample')}</Txt> : null}
        {photoIssue ? <Txt variant="footnote" color="danger" testID="tsetup-photo-error">{photoIssue === 'DENIED' ? t('tsetup.photoDenied') : t('tsetup.photoFailed')}</Txt> : null}
        {touched && problems.photo ? <Txt variant="footnote" color="danger" testID="tsetup-photo-needed">{t('tsetup.photoNeeded')}</Txt> : null}
      </View>

      {locked ? (
        <View style={styles.readOnly} testID="tsetup-name-locked">
          <Txt variant="caption" color="inkMuted">{t('id.legalName')}</Txt>
          <View style={styles.lockRow}>
            <Txt variant="bodyStrong" style={styles.flex}>{p.identity?.legalName}</Txt>
            <Icon name="lock-closed" size={16} color="inkMuted" />
          </View>
        </View>
      ) : (
        <Field label={t('tsetup.legalName')} hint={t('tsetup.legalNameHint')} value={name} onChangeText={setName} autoCapitalize="words" maxLength={60}
          autoCorrect={false} testID="tsetup-name" error={touched && problems.name ? t('auth.profile.invalid') : null} />
      )}

      <View style={styles.block}>
        <Txt variant="label">{t('tsetup.gender')}</Txt>
        <View style={styles.row}>
          <Chip label={t('tsetup.male')} selected={gender === 'M'} onPress={() => setGender('M')} testID="tsetup-gender-M" />
          <Chip label={t('tsetup.female')} selected={gender === 'F'} onPress={() => setGender('F')} testID="tsetup-gender-F" />
        </View>
        {touched && problems.gender ? <Txt variant="footnote" color="danger">{t('tsetup.pick')}</Txt> : null}
      </View>

      <View style={styles.block}>
        <Txt variant="label">{t('tsetup.experience')}</Txt>
        <View style={styles.stepper}>
          <Tap onPress={() => setYears((y) => Math.max(0, y - 1))} style={styles.stepBtn} accessibilityLabel="-" testID="tsetup-years-minus"><Icon name="remove" size={22} color="navy" /></Tap>
          <View style={styles.flexCenter}>
            <Txt variant="title1" testID="tsetup-years">{years}</Txt>
            <Txt variant="caption" color="inkMuted">{t('tsetup.years')}</Txt>
          </View>
          <Tap onPress={() => setYears((y) => Math.min(50, y + 1))} style={styles.stepBtn} accessibilityLabel="+" testID="tsetup-years-plus"><Icon name="add" size={22} color="navy" /></Tap>
        </View>
      </View>

      <View style={styles.block}>
        <Txt variant="label">{t('tsetup.skills')}</Txt>
        <View style={styles.grid}>
          {CATEGORIES.map((c) => {
            const on = skills.includes(c.id);
            return (
              <Tap key={c.id} onPress={() => toggle(c.id)} style={styles.cell} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={l(c.name)} testID={`tsetup-skill-${c.id}`}>
                <Wash name={c.wash} style={[styles.skill, on && styles.skillOn]}>
                  <Art3D name={c.art} size={56} />
                  {on ? <View style={styles.tick}><Icon name="checkmark" size={14} color="onNavy" /></View> : null}
                </Wash>
                <Txt variant="caption" align="center" weight={on ? 'bold' : 'medium'} color={on ? 'navy' : 'ink'} numberOfLines={1}>{l(c.name)}</Txt>
              </Tap>
            );
          })}
        </View>
        {touched && problems.skills ? <Txt variant="footnote" color="danger">{t('tsetup.pickSkill')}</Txt> : null}
      </View>

      <View style={styles.row}>
        <View style={styles.flex}>
          <Field label={t('address.city')} value={city} onChangeText={setCity} autoCapitalize="words" maxLength={60} testID="tsetup-city"
            error={touched && problems.city ? t('address.required') : null} />
        </View>
        <View style={styles.flex}>
          <Field label={t('address.pincode')} value={pincode} onChangeText={(v) => setPincode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} testID="tsetup-pincode"
            error={touched && problems.pincode ? t('address.pincodeInvalid') : null} />
        </View>
      </View>
      <Field label={t('tsetup.areas')} hint={t('tsetup.areasHint')} value={areas} onChangeText={setAreas} maxLength={200} testID="tsetup-areas"
        error={touched && problems.areas ? t('tsetup.areasErr') : null} />
      <Field label={t('tsetup.vehicle')} optional value={vehicle} onChangeText={setVehicle} maxLength={40} placeholder="Scooter · TS 09 AB 1234" testID="tsetup-vehicle" />

      <View style={styles.idRow}>
        <Art3D name="clipboard" size={40} />
        <View style={styles.flex}>
          <Txt variant="bodyStrong">{t('tsetup.id')}</Txt>
          <Txt variant="footnote" color="inkMuted">{t('tsetup.idSub')}</Txt>
        </View>
        <Pill label={t('common.soon')} tone="demo" />
      </View>
      <ErrorBanner error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexCenter: { flex: 1, alignItems: 'center' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  block: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  stepBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs, rowGap: space.md },
  cell: { width: '33.33%', paddingHorizontal: space.xs, gap: space.xs },
  skill: { aspectRatio: 1.1, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  skillOn: { borderColor: colors.blue },
  tick: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  photoEmpty: { width: 96, height: 96, borderRadius: 27, backgroundColor: colors.surfaceMuted, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  photoMissing: { borderColor: colors.danger },
  photoBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  sample: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.demoTint },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  readOnly: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.line },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong },
});
