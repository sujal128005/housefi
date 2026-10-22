// Aadhaar verification for technicians: the camera reads the Secure QR code printed on the Aadhaar card (or the e-Aadhaar
// PDF), and the server checks UIDAI's digital signature offline. Nothing is sent to UIDAI, and Housefi keeps only the
// last 4 digits, the birth year, the gender and whether the name matches: never the Aadhaar number, photo or address.
// During registration it is the required step after the details (no way back, no skipping), and it leads to
// "checking your details". Scanning uses the phone's own smart scanner where there is one (Google code scanner on
// Android, VisionKit on iPhone): it finds the code anywhere in view, zooms in and captures by itself. Otherwise the
// in-app camera (tall, focusing on its own, with a light and 1x / 2x / 3x zoom for codes far away or in the dark;
// after a few seconds without a code it offers tips and a photo instead). A photo works too, read at full quality:
// a picture of the card, or an e-Aadhaar screenshot.
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { techStage } from '../../domain/techReview';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n } from '../../i18n/I18n';
import { resetTo } from '../../navigation';
import { isApiError } from '../../services/api';
import { pickCodePhoto } from '../../services/device';
import { feedback } from '../../services/feedback';
import { useBackend } from '../../services/ServicesProvider';
import { useAppState, useTechSession } from '../../state/AppState';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, ErrorBanner, Header, Icon, Screen, Tap, Txt } from '../../ui';
import { Celebrate } from '../../ui/motion';

type Phase = 'INTRO' | 'SCANNING' | 'CHECKING' | 'DONE';

/** In-app camera zoom steps (expo-camera's 0..1 scale): 1x, about 2x and about 3x. */
const ZOOMS = [0, 0.25, 0.45] as const;
/** Tips and the photo option appear when no Aadhaar code was read for this long. */
const SLOW_MS = 7000;

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
  const [zoom, setZoom] = useState(0);
  const [torch, setTorch] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (phase !== 'SCANNING') return undefined;
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  // The registration step (profile submitted, Aadhaar not yet scanned), as opposed to opening it from the checking page.
  const [required] = useState(() => techStage(session.profile, Date.now()) === 'AADHAAR');
  const next = () => (required ? resetTo('/tech/verification') : router.back());

  // The smart scanner reports here; it is listened to only while this screen is open.
  const onScannedRef = useRef<(data: string) => void>(() => undefined);
  useEffect(() => {
    if (Platform.OS === 'web' || !CameraView.isModernBarcodeScannerAvailable) return undefined;
    const sub = CameraView.onModernBarcodeScanned((e) => onScannedRef.current(e.data));
    return () => sub.remove();
  }, []);

  const startScan = async () => {
    setError(null);
    setHint(null);
    const p = permission?.granted ? permission : await requestPermission();
    if (!p.granted) {
      setHint(t('aadhaar.cameraDenied'));
      return;
    }
    handled.current = false;
    if (Platform.OS !== 'web' && CameraView.isModernBarcodeScannerAvailable) {
      try {
        await CameraView.launchScanner({ barcodeTypes: ['qr'], isGuidanceEnabled: true, isHighlightingEnabled: true });
        return;
      } catch {
        // Not available on this phone after all: the in-app camera below.
      }
    }
    setPhase('SCANNING');
  };

  /** A photo of the code (a screenshot of the e-Aadhaar, or a picture of the card), read at full quality. */
  const fromPhoto = async (source: 'camera' | 'gallery' = 'gallery') => {
    setError(null);
    setHint(null);
    setTorch(false);
    const r = await pickCodePhoto(source);
    if (!r.ok) return;
    try {
      const found = await scanFromURLAsync(r.uri, ['qr']);
      const code = found.find((f) => looksLikeSecureQr(f.data)) ?? found[0];
      handled.current = false;
      if (code) await onScanned(code.data);
      else {
        setPhase('INTRO');
        setHint(t('aadhaar.noCodeInPhoto'));
      }
    } catch {
      setPhase('INTRO');
      setHint(t('aadhaar.noCodeInPhoto'));
    }
  };

  const onScanned = async (data: string) => {
    if (handled.current) return;
    if (!looksLikeSecureQr(data)) {
      setHint(t('aadhaar.notSecureQr'));
      return;
    }
    if (Platform.OS === 'ios' && CameraView.isModernBarcodeScannerAvailable) void CameraView.dismissScanner().catch(() => undefined);
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
  onScannedRef.current = (data) => void onScanned(data);

  return (
    <Screen
      testID="tech-aadhaar"
      wash={phase === 'DONE' ? 'mint' : 'sky'}
      header={<Header title={t('aadhaar.title')} back={!required} />}
      footer={phase === 'DONE' ? (
        <Button label={required ? t('common.continue') : t('common.done')} icon={required ? undefined : 'checkmark'} trailingIcon={required ? 'arrow-forward' : undefined} variant="lime" onPress={next} testID="aadhaar-done" />
      ) : phase === 'INTRO' ? (
        <>
          <Button label={t('aadhaar.scan')} icon="qr-code" onPress={() => void startScan()} disabled={Platform.OS === 'web'} testID="aadhaar-scan" />
          <Button label={t('aadhaar.fromPhoto')} icon="image" variant="ghost" size="md" onPress={() => void fromPhoto('gallery')} disabled={Platform.OS === 'web'} testID="aadhaar-photo" />
        </>
      ) : undefined}
    >
      {phase === 'INTRO' ? (
        <>
          <View style={styles.art}><Art3D name="shield" size={120} float shadow /></View>
          <Txt variant="title1" heading>{t('aadhaar.heading')}</Txt>
          <Txt variant="body" color="inkMuted">{t('aadhaar.body')}</Txt>
          {required ? <Banner tone="info" icon="shield-checkmark" text={t('aadhaar.required')} testID="aadhaar-required" /> : null}
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
            {/* autofocus "off" is continuous focus (expo-camera); the whole frame is searched, not just the corners */}
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} autofocus="off"
              zoom={zoom} enableTorch={torch} onBarcodeScanned={(r) => void onScanned(r.data)} />
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <View key={c} style={[styles.corner, styles[c]]} pointerEvents="none" />)}
            <View style={styles.camControls}>
              <Tap onPress={() => setTorch((v) => !v)} style={[styles.camBtn, torch && styles.camBtnOn]} accessibilityLabel={t('aadhaar.light')} accessibilityState={{ selected: torch }} testID="aadhaar-torch">
                <Icon name={torch ? 'flashlight' : 'flashlight-outline'} size={20} color={torch ? 'onLime' : 'onNavy'} />
              </Tap>
              <Tap onPress={() => setZoom((z) => ZOOMS[(ZOOMS.indexOf(z as (typeof ZOOMS)[number]) + 1) % ZOOMS.length] ?? 0)} style={styles.camBtn} accessibilityLabel={t('aadhaar.zoom')} testID="aadhaar-zoom">
                <Txt variant="label" color="onNavy">{`${ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]) + 1}x`}</Txt>
              </Tap>
            </View>
          </View>
          {hint ? <Banner tone="warning" text={hint} testID="aadhaar-hint" /> : slow ? <Banner tone="info" icon="bulb-outline" text={t('aadhaar.slowHint')} testID="aadhaar-slow" /> : <Txt variant="footnote" color="inkMuted" align="center">{t('aadhaar.scanHint')}</Txt>}
          {slow ? <Button label={t('aadhaar.takePhoto')} icon="camera" variant="secondary" onPress={() => void fromPhoto('camera')} testID="aadhaar-take-photo" /> : null}
          <Button label={t('common.cancel')} variant="outline" onPress={() => { setTorch(false); setPhase('INTRO'); }} testID="aadhaar-cancel" />
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
  cameraFrame: { aspectRatio: 3 / 4, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' },
  corner: { position: 'absolute', width: 40, height: 40, borderColor: colors.lime },
  tl: { top: '10%', left: '8%', borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 16 },
  tr: { top: '10%', right: '8%', borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 16 },
  bl: { bottom: '18%', left: '8%', borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 16 },
  br: { bottom: '18%', right: '8%', borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 16 },
  camControls: { position: 'absolute', bottom: space.lg, alignSelf: 'center', flexDirection: 'row', gap: space.md },
  camBtn: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  camBtnOn: { backgroundColor: colors.lime, borderColor: colors.lime },
  result: { gap: space.md, alignSelf: 'stretch' },
});
