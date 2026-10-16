// Technician profile: name, gender, experience, skills, service area and vehicle. Submitting sends it for
// verification (Pending -> Approved / Needs correction). Also used to fix or edit the profile (?edit=1).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CATEGORIES } from '../../data/catalog';
import { isValidName, isValidPincode } from '../../domain/rules';
import type { CategoryId, Gender } from '../../domain/types';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n } from '../../i18n/I18n';
import { resetTo } from '../../navigation';
import { feedback } from '../../services/feedback';
import { useBackend } from '../../services/ServicesProvider';
import { useAppState, useTechSession } from '../../state/AppState';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Chip, ErrorBanner, Field, Header, Icon, Pill, Screen, Tap, Txt, Wash } from '../../ui';

export default function TechSetup() {
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const { updateTech } = useAppState();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const p = session.profile;
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
    name: !isValidName(name),
    gender: gender === null,
    skills: skills.length === 0,
    city: city.trim().length < 2,
    pincode: !isValidPincode(pincode.trim()),
    areas: areas.trim().length < 2,
  };
  const ok = !Object.values(problems).some(Boolean);

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
      const profile = await backend.tech.submitProfile(session.token, { name, gender, experienceYears: years, skills, city, pincode, areas, vehicle });
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
        <Art3D name="tech_man" size={110} float shadow badge="toolbox" />
        <View style={styles.flex}>
          <Txt variant="title2" heading>{t('tsetup.heading')}</Txt>
          <Txt variant="callout" color="inkMuted">{t('tsetup.body')}</Txt>
        </View>
      </View>
      {p.correctionNote ? <Banner tone="warning" icon="alert-circle" text={l(p.correctionNote)} testID="tsetup-correction" /> : null}
      {p.verification === 'APPROVED' ? <Banner tone="info" text={t('tsetup.reverify')} /> : null}

      <Field label={t('tsetup.name')} value={name} onChangeText={setName} autoCapitalize="words" maxLength={60} testID="tsetup-name"
        error={touched && problems.name ? t('auth.profile.invalid') : null} />

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
  idRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong },
});
