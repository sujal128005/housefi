// Technician profile: verification, rating, skills and service area, language, sounds & vibration, help, demo
// settings, switch to the customer app, sign out.
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
import { useAppState, useTechSession } from '../../../state/AppState';
import { colors, GUTTER, radius, space } from '../../../theme/tokens';
import { Card, ConfirmSheet, DemoPill, Divider, ListRow, NotInDemoSheet, Pill, Screen, Txt, Wash } from '../../../ui';

export default function TechProfile() {
  const { t, l, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const session = useTechSession();
  const { techSignOut, setRole, prefs, setFeedback } = useAppState();
  const [confirm, setConfirm] = useState(false);
  const [support, setSupport] = useState(false);
  const p = session.profile;
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
          <View style={styles.avatar}><Art3D name={p.gender === 'F' ? 'tech_woman' : 'tech_man'} size={60} /></View>
          <View style={styles.flex}>
            <Txt variant="title2" testID="tprofile-name">{p.name}</Txt>
            <Txt variant="callout" color="inkMuted">{formatPhone(p.phone)}</Txt>
            <View style={styles.pills}>
              <Pill label={t('tprofile.verified')} tone="success" icon="shield-checkmark" />
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

      <Card style={styles.list}>
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
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  skill: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, minHeight: 40, borderRadius: radius.pill, backgroundColor: colors.surface },
  list: { paddingVertical: space.xs },
});
