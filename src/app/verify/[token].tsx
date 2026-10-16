// Housefi verification page for a scanned Technician ID card (opened from the QR code: housefi://verify/<token> in the
// demo; Housefi's public verification page on the live backend). No sign-in. Shows the minimum: photo, first name
// and initial, Technician ID, and whether the technician is active with Housefi right now.
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n } from '../../i18n/I18n';
import { resetTo } from '../../navigation';
import { isApiError } from '../../services/api';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, EmptyState, ErrorView, Header, Icon, Screen, Skeleton, Txt } from '../../ui';
import { Logo } from '../../ui/Logo';
import { TechPhoto, VerificationPill } from '../../ui/TechIdentity';

export default function VerifyTechnician() {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const { token } = useLocalSearchParams<{ token: string }>();
  const q = useQuery(() => backend.verify.technician(token ?? ''), [backend, token]);
  const r = q.data;
  const done = () => (router.canGoBack() ? router.back() : resetTo('/'));

  return (
    <Screen testID="verify-page" header={<Header title={t('verify.title')} onBack={done} />}
      footer={<Button label={t('verify.done')} variant="outline" onPress={done} testID="verify-done" />}>
      <View style={styles.brand}><Logo /></View>
      {q.loading && !r ? <Skeleton style={styles.skel} /> : null}
      {q.error && !r ? (
        isApiError(q.error, 'NOT_FOUND')
          ? <EmptyState testID="verify-not-found" art={<Art3D name="no_results" size={110} />} title={t('verify.notFound')} />
          : <ErrorView error={q.error} onRetry={q.reload} />
      ) : null}
      {r ? (
        <View style={styles.card} testID={r.active ? 'verify-active' : 'verify-inactive'}>
          <TechPhoto photo={r.photo} gender={r.gender} size={96} />
          <Txt variant="title2" align="center">{r.displayName}</Txt>
          <Txt variant="label" color="navy" lang="en" style={styles.code}>{r.techCode}</Txt>
          <View style={[styles.state, r.active ? styles.on : styles.off]}>
            <Icon name={r.active ? 'checkmark-circle' : 'close-circle'} size={22} color={r.active ? 'success' : 'danger'} />
            <Txt variant="bodyStrong" color={r.active ? 'onSuccessTint' : 'onDangerTint'}>{r.active ? t('verify.active') : t('verify.inactive')}</Txt>
          </View>
          <View style={styles.pillRow}><VerificationPill state={r.verification} simulated={r.simulated} /></View>
          <Txt variant="caption" color="inkMuted">{t('verify.checked', { time: new Date(r.checkedAt).toLocaleTimeString(locale === 'te' ? 'te-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' }) })}</Txt>
          {r.fictional ? <Txt variant="caption" color="demo" align="center">{t('id.fictional')}</Txt> : null}
        </View>
      ) : null}
      <Banner tone="demo" text={t('verify.demo')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', paddingVertical: space.sm },
  skel: { height: 320, borderRadius: radius.xxl },
  card: { alignItems: 'center', gap: space.sm, padding: space.xl, borderRadius: radius.xxl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  code: { letterSpacing: 1.6 },
  pillRow: { flexDirection: 'row', justifyContent: 'center', alignSelf: 'stretch' },
  state: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
  on: { backgroundColor: colors.successTint },
  off: { backgroundColor: colors.dangerTint },
});
