// Technician profile: photo, verification, rating, skills and service area; the read-only identity (legal name,
// verification status, Housefi Technician ID), My Housefi ID card and identity correction requests; language, sounds
// & vibration, help, demo settings, switch to the customer app, sign out.
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { categoryById } from '../../../data/catalog';
import { Art3D } from '../../../illustrations/Art3D';
import { formatPhone } from '../../../i18n/format';
import { useI18n } from '../../../i18n/I18n';
import { resetTo } from '../../../navigation';
import { useBackend } from '../../../services/ServicesProvider';
import { feedback } from '../../../services/feedback';
import { useAppState, useTechSession } from '../../../state/AppState';
import { colors, GUTTER, radius, space } from '../../../theme/tokens';
import { Banner, Button, Card, Chip, ConfirmSheet, DemoPill, Divider, ErrorBanner, Field, Icon, ListRow, NotInDemoSheet, Pill, Screen, Sheet, Txt, Wash, useToast } from '../../../ui';
import { TechPhoto, VerificationPill } from '../../../ui/TechIdentity';

export default function TechProfile() {
  const { t, l, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const session = useTechSession();
  const { techSignOut, setRole, prefs, setFeedback, updateTech } = useAppState();
  const backend = useBackend();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [support, setSupport] = useState(false);
  const [fix, setFix] = useState(false);
  const [fixKind, setFixKind] = useState<'NAME' | 'PHOTO'>('NAME');
  const [fixNote, setFixNote] = useState('');
  const [fixBusy, setFixBusy] = useState(false);
  const [fixError, setFixError] = useState<unknown>(null);
  const p = session.profile;
  const idn = p.identity;
  const simulated = idn?.simulated ?? true;

  const sendFix = async () => {
    setFixBusy(true);
    setFixError(null);
    try {
      updateTech(await backend.tech.requestIdentityCorrection(session.token, fixKind, fixNote));
      feedback('send');
      setFix(false);
      setFixNote('');
      toast.show(t('id.correctionSent'), 'checkmark-circle');
    } catch (e) {
      feedback('error');
      setFixError(e);
    } finally {
      setFixBusy(false);
    }
  };
  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <Screen
      testID="tech-profile"
      header={
        <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
          <Txt variant="title1" heading style={styles.flex}>{t('ttab.profile')}</Txt>
          <DemoPill />
        </View>
      }
    >
      <Wash name="mint" style={styles.card}>
        <View style={styles.row}>
          <TechPhoto photo={idn?.photo} gender={p.gender} size={72} />
          <View style={styles.flex}>
            <Txt variant="title2" testID="tprofile-name">{p.name}</Txt>
            <Txt variant="callout" color="inkMuted">{formatPhone(p.phone)}</Txt>
            <View style={styles.pills}>
              <VerificationPill state={p.verification} simulated={simulated} />
              <Pill label={p.rating ? `★ ${p.rating.toFixed(1)}` : t('track.newTech')} tone="warning" />
              <Pill label={t('track.jobs', { count: p.jobsDone })} tone="info" />
            </View>
          </View>
        </View>
        <Txt variant="label" color="inkMuted">{t('tsetup.skills')}</Txt>
        <View style={styles.skills}>
          {p.skills.map((k) => {
            const c = categoryById(k);
            return c ? (
              <View key={k} style={styles.skill}>
                <Art3D name={c.art} size={24} />
                <Txt variant="label">{l(c.name)}</Txt>
              </View>
            ) : null;
          })}
        </View>
        <Txt variant="footnote" color="inkMuted">{t('tprofile.area', { areas: p.areas, city: p.city, pincode: p.pincode })} · {t('track.experience', { years: p.experienceYears })}</Txt>
      </Wash>

      {/* identity: read-only, corrected only by Housefi support */}
      <Card style={styles.identity} testID="tprofile-identity">
        <Txt variant="title3" heading>{t('id.section')}</Txt>
        <View style={styles.field}>
          <Txt variant="caption" color="inkMuted">{t('id.legalName')}</Txt>
          <Txt variant="bodyStrong" testID="tprofile-legal-name">{idn?.legalName ?? p.name}</Txt>
        </View>
        <Divider />
        <View style={styles.field}>
          <Txt variant="caption" color="inkMuted">{t('id.statusLabel')}</Txt>
          <View style={styles.pillLine}><VerificationPill state={p.verification} simulated={simulated} /></View>
        </View>
        <Divider />
        <View style={styles.field}>
          <Txt variant="caption" color="inkMuted">{t('id.codeLabel')}</Txt>
          <Txt variant="bodyStrong" color={idn ? 'navy' : 'inkMuted'} lang="en" style={styles.code} testID="tprofile-tech-id">{idn?.techCode ?? t('id.notIssued')}</Txt>
        </View>
        <View style={styles.lockRow}>
          <Icon name="lock-closed" size={14} color="inkMuted" />
          <Txt variant="footnote" color="inkMuted" style={styles.flex}>{t('id.locked')}</Txt>
        </View>
        {idn?.correctionRequest ? (
          <Banner tone="info" icon="time" text={`${t('id.correctionSent')} ${t('id.correctionDemo')}`} testID="tprofile-correction-sent" />
        ) : null}
      </Card>

      <Card style={styles.list}>
        {idn ? (
          <>
            <ListRow icon="id-card-outline" title={t('id.open')} subtitle={t('id.openSub')} onPress={() => router.push('/tech/id-card')} testID="tprofile-id-card" />
            <Divider />
            <ListRow icon="help-buoy-outline" title={t('id.correction')} subtitle={t('id.correctionSub')} onPress={() => setFix(true)} testID="tprofile-correction" />
            <Divider />
          </>
        ) : null}
        <ListRow icon="create-outline" title={t('tprofile.edit')} subtitle={t('tprofile.editSub')} onPress={() => router.push({ pathname: '/tech/setup', params: { edit: '1' } })} testID="tprofile-edit" />
        <Divider />
        <ListRow icon="language-outline" title={t('account.language')} subtitle={locale === 'te' ? 'తెలుగు' : 'English'} testID="tprofile-language"
          onPress={() => router.push({ pathname: '/language', params: { from: 'account' } })} />
        <Divider />
        <ListRow icon="volume-high-outline" title={t('account.feedback')} subtitle={t('account.feedbackSub')} testID="tprofile-feedback"
          right={<Switch value={prefs.feedback} onValueChange={setFeedback} trackColor={{ true: colors.blue, false: colors.lineStrong }} thumbColor={colors.surface}
            accessibilityLabel={t('account.feedback')} />} />
        <Divider />
        <ListRow icon="headset-outline" title={t('tprofile.support')} subtitle={t('tprofile.supportSub')} onPress={() => setSupport(true)} testID="tprofile-support" />
        <Divider />
        <ListRow icon="flask-outline" title={t('account.demo')} onPress={() => router.push('/demo')} testID="tprofile-demo" />
        <Divider />
        <ListRow icon="home-outline" title={t('tprofile.switch')} testID="tprofile-switch" onPress={() => {
          setRole('CUSTOMER');
          resetTo('/');
        }} />
        <Divider />
        <ListRow icon="document-text-outline" title={t('account.legal')} onPress={() => router.push('/legal')} />
      </Card>

      <Card style={styles.list}>
        <ListRow icon="log-out-outline" title={t('account.signOut')} tone="danger" onPress={() => setConfirm(true)} testID="tprofile-signout" />
      </Card>
      <Txt variant="footnote" color="inkSubtle" align="center">{t('account.version', { v: version })}</Txt>

      <Sheet visible={fix} onClose={() => setFix(false)} testID="correction-sheet">
        <View style={styles.sheet}>
          <Txt variant="title2" heading>{t('id.correction')}</Txt>
          <Txt variant="callout" color="inkMuted">{t('id.correctionSub')}</Txt>
          <Txt variant="label">{t('id.correctionWhat')}</Txt>
          <View style={styles.chips}>
            <Chip label={t('id.correctionName')} selected={fixKind === 'NAME'} onPress={() => setFixKind('NAME')} testID="correction-NAME" />
            <Chip label={t('id.correctionPhoto')} selected={fixKind === 'PHOTO'} onPress={() => setFixKind('PHOTO')} testID="correction-PHOTO" />
          </View>
          <Field label={t('id.correctionNote')} value={fixNote} onChangeText={setFixNote} maxLength={300} multiline testID="correction-note" />
          <Banner tone="demo" text={t('id.correctionDemo')} />
          <ErrorBanner error={fixError} />
          <Button label={t('id.correctionSend')} icon="send" onPress={() => void sendFix()} loading={fixBusy} disabled={fixNote.trim().length < 3} testID="correction-send" />
        </View>
      </Sheet>
      <NotInDemoSheet visible={support} title={t('tprofile.support')} onClose={() => setSupport(false)} />
      <ConfirmSheet visible={confirm} title={t('account.signOutTitle')} body={t('tprofile.signOutBody')} icon="log-out-outline" confirmLabel={t('account.signOut')}
        confirmVariant="danger" onCancel={() => setConfirm(false)} onConfirm={() => {
          setConfirm(false);
          void techSignOut();
          resetTo('/auth/phone');
        }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: GUTTER, paddingBottom: space.sm },
  card: { gap: space.md, padding: space.lg, borderRadius: radius.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identity: { gap: space.md },
  field: { gap: 2 },
  pillLine: { flexDirection: 'row', marginTop: space.xxs },
  code: { letterSpacing: 1.4 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sheet: { gap: space.md },
  chips: { flexDirection: 'row', gap: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  skill: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, minHeight: 40, borderRadius: radius.pill, backgroundColor: colors.surface },
  list: { paddingVertical: space.xs },
});
