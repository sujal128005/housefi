import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPhone } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { resetTo } from '../../navigation';
import { useAppState, useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { colors, GUTTER, radius, space } from '../../theme/tokens';
import { Card, ConfirmSheet, DemoPill, Divider, ListRow, Screen, Tap, Txt, Wash } from '../../ui';

export default function Account() {
  const { t, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const { signOut, setRole, prefs, setFeedback } = useAppState();
  const draft = useDraft();
  const [confirm, setConfirm] = useState(false);
  const c = session.customer;
  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <Screen
      testID="account"
      header={
        <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
          <Txt variant="title1" heading style={styles.flex}>{t('account.title')}</Txt>
          <DemoPill />
        </View>
      }
    >
      <Wash name="lavender" style={styles.profile}>
        <View style={styles.avatar}><Txt variant="title1" color="onNavy">{(c.name[0] ?? '?').toUpperCase()}</Txt></View>
        <View style={styles.flex}>
          <Txt variant="title2" testID="account-name">{c.name}</Txt>
          <Txt variant="callout" color="inkMuted">{formatPhone(c.phone)}</Txt>
        </View>
        <Tap onPress={() => router.push({ pathname: '/auth/name', params: { edit: '1' } })} style={styles.edit} accessibilityLabel={t('account.editName')} testID="account-edit-name">
          <Txt variant="label" color="blue">{t('common.edit')}</Txt>
        </Tap>
      </Wash>

      <Card style={styles.list}>
        <ListRow icon="location-outline" title={t('account.addresses')} onPress={() => router.push('/addresses')} testID="account-addresses" />
        <Divider />
        <ListRow icon="language-outline" title={t('account.language')} subtitle={locale === 'te' ? 'తెలుగు' : 'English'} testID="account-language"
          onPress={() => router.push({ pathname: '/language', params: { from: 'account' } })} />
        <Divider />
        <ListRow icon="volume-high-outline" title={t('account.feedback')} subtitle={t('account.feedbackSub')} testID="account-feedback"
          right={<Switch value={prefs.feedback} onValueChange={setFeedback} trackColor={{ true: colors.blue, false: colors.lineStrong }} thumbColor={colors.surface}
            accessibilityLabel={t('account.feedback')} testID="account-feedback-switch" />} />
        <Divider />
        <ListRow icon="flask-outline" title={t('account.demo')} onPress={() => router.push('/demo')} testID="account-demo" />
        <Divider />
        <ListRow icon="construct-outline" title={t('account.switch')} testID="account-switch" onPress={() => {
          setRole('TECHNICIAN');
          resetTo('/');
        }} />
        <Divider />
        <ListRow icon="document-text-outline" title={t('account.legal')} onPress={() => router.push('/legal')} />
      </Card>

      <Card style={styles.list}>
        <ListRow icon="log-out-outline" title={t('account.signOut')} tone="danger" onPress={() => setConfirm(true)} testID="account-signout" />
      </Card>

      <Txt variant="footnote" color="inkSubtle" align="center">{t('account.version', { v: version })}</Txt>

      <ConfirmSheet visible={confirm} title={t('account.signOutTitle')} body={t('account.signOutBody')} icon="log-out-outline" confirmLabel={t('account.signOut')}
        confirmVariant="danger" onCancel={() => setConfirm(false)} onConfirm={() => {
          setConfirm(false);
          draft.clear();
          void signOut();
          resetTo('/auth/phone');
        }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: GUTTER, paddingBottom: space.sm },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xxl },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  edit: { minHeight: 44, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  list: { paddingVertical: space.xs },
});
