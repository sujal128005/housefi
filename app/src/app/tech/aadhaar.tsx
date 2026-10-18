// Aadhaar verification for technicians: the camera reads the Secure QR code printed on the Aadhaar card (or the e-Aadhaar
// PDF), and the server checks UIDAI's digital signature offline. Nothing is sent to UIDAI, and Housefi keeps only the
// last 4 digits, the birth year, the gender and whether the name matches: never the Aadhaar number, photo or address.
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n } from '../../i18n/I18n';
import { isApiError } from '../../services/api';
import { feedback } from '../../services/feedback';
import { useBackend } from '../../services/ServicesProvider';
import { useAppState, useTechSession } from '../../state/AppState';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, ErrorBanner, Header, Icon, Screen, Txt } from '../../ui';
import { Celebrate } from '../../ui/motion';

type Phase = 'INTRO' | 'SCANNING' | 'CHECKING' | 'DONE';

/** The Secure QR holds a long decimal number; anything else (a payment QR, a URL) is not an Aadhaar code. */
const looksLikeSecureQr = (data: string) => /^\d{200,}$/.test(data.trim());

export default function AadhaarScan() {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const { updateTech } = useAppState();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>(session.profile.aadhaar ? 'DONE' : 'INTRO');
  const [error, setError] = useState<unknown>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [result, setResult] = useState(session.profile.aadhaar ?? null);
  const handled = useRef(false);

  const startScan = async () => {
    setError(null);
    setHint(null);
    const p = permission?.granted ? permission : await requestPermission();
    if (!p.granted) {
      setHint(t('aadhaar.cameraDenied'));
      return;
    }
    handled.current = false;
    setPhase('SCANNING');
  };

  const onScanned = async ({ data }: BarcodeScanningResult) => {
    if (handled.current) return;
    if (!looksLikeSecureQr(data)) {
      setHint(t('aadhaar.notSecureQr'));
      return;
    }
    handled.current = true;
    feedback('pop');
    setPhase('CHECKING');
    try {
      const r = await backend.tech.verifyAadhaar(session.token, data.trim());
      setResult(r);
      updateTech(await backend.tech.me(session.token));
      feedback('success');
      setPhase('DONE');
    } catch (e) {
      setError(e);
      setHint(isApiError(e, 'CONFLICT') ? t('aadhaar.inUse') : isApiError(e, 'VALIDATION') ? t('aadhaar.invalid') : null);
      setPhase('INTRO');
    }
  };

  return (
    <Screen
      testID="tech-aadhaar"
      wash={phase === 'DONE' ? 'mint' : 'sky'}
      header={<Header title={t('aadhaar.title')} />}
      footer={phase === 'DONE' ? (
        <Button label={t('common.done')} icon="checkmark" onPress={() => router.back()} testID="aadhaar-done" />
      ) : phase === 'INTRO' ? (
        <Button label={t('aadhaar.scan')} icon="qr-code" onPress={() => void startScan()} disabled={Platform.OS === 'web'} testID="aadhaar-scan" />
      ) : undefined}
    >
      {phase === 'INTRO' ? (
        <>
          <View style={styles.art}><Art3D name="shield" size={120} float shadow /></View>
          <Txt variant="title1" heading>{t('aadhaar.heading')}</Txt>
          <Txt variant="body" color="inkMuted">{t('aadhaar.body')}</Txt>
          <Card style={styles.steps}>
            {(['aadhaar.step1', 'aadhaar.step2', 'aadhaar.step3'] as const).map((k, i) => (
              <View key={k} style={styles.step}>
                <View style={styles.num}><Txt variant="label" color="onNavy">{i + 1}</Txt></View>
                <Txt variant="callout" style={styles.flex}>{t(k)}</Txt>
              </View>
            ))}
          </Card>
          <Banner tone="info" icon="lock-closed" text={t('aadhaar.privacy')} />
          {Platform.OS === 'web' ? <Banner tone="warning" text={t('aadhaar.phoneOnly')} /> : null}
          {hint ? <Banner tone="warning" text={hint} testID="aadhaar-hint" /> : null}
          {!hint ? <ErrorBanner error={error} /> : null}
        </>
      ) : null}

      {phase === 'SCANNING' ? (
        <>
          <Txt variant="title2" heading align="center">{t('aadhaar.pointCamera')}</Txt>
          <View style={styles.cameraFrame}>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => void onScanned(r)} />
            <View style={styles.reticle} pointerEvents="none" />
          </View>
          {hint ? <Banner tone="warning" text={hint} testID="aadhaar-hint" /> : <Txt variant="footnote" color="inkMuted" align="center">{t('aadhaar.scanHint')}</Txt>}
          <Button label={t('common.cancel')} variant="outline" onPress={() => setPhase('INTRO')} testID="aadhaar-cancel" />
        </>
      ) : null}

      {phase === 'CHECKING' ? (
        <View style={styles.center}>
          <Art3D name="shield" size={110} float />
          <Txt variant="title2" align="center">{t('aadhaar.checking')}</Txt>
        </View>
      ) : null}

      {phase === 'DONE' && result ? (
        <View style={styles.center} testID="aadhaar-verified">
          <Celebrate size={130}><Art3D name="verify_ok" size={120} /></Celebrate>
          <Txt variant="title1" align="center" heading>{t('aadhaar.verified')}</Txt>
          <Card style={styles.result}>
            <View style={styles.step}>
              <Icon name="card" size={20} color="navy" />
              <Txt variant="bodyStrong" style={styles.flex}>{t('aadhaar.last4', { last4: result.last4 })}</Txt>
            </View>
            <View style={styles.step}>
              <Icon name={result.nameMatches ? 'checkmark-circle' : 'alert-circle'} size={20} color={result.nameMatches ? 'success' : 'warning'} />
              <Txt variant="callout" style={styles.flex}>{result.nameMatches ? t('aadhaar.nameOk') : t('aadhaar.nameDiffers')}</Txt>
            </View>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  art: { alignItems: 'center' },
  center: { alignItems: 'center', gap: space.lg, paddingVertical: space.xl },
  steps: { gap: space.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  cameraFrame: { aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' },
  reticle: { position: 'absolute', top: '12%', left: '12%', right: '12%', bottom: '12%', borderWidth: 3, borderColor: '#FFFFFF', borderRadius: radius.md },
  result: { gap: space.md, alignSelf: 'stretch' },
});
