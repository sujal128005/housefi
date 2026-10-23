// Aadhaar verification for technicians: the camera reads the Secure QR code printed on the Aadhaar card (or the e-Aadhaar
// PDF), and the server checks UIDAI's digital signature offline. Nothing is sent to UIDAI, and Housefi keeps only the
// last 4 digits, the birth year, the gender and whether the name matches: never the Aadhaar number, photo or address.
// During registration it is the required step after the details (no way back, no skipping), and it leads to the
// skill check (or "checking your details").
// Scanning is built for speed, like a payment app's scanner:
// - The camera is live the moment the screen opens (permission is asked straight away the first time) and reads from
//   the first frame: full-resolution analysis, continuous focus, a light, and 1x / 2x / 3x zoom for small or far codes.
// - One tap opens the phone's own smart scanner instead (Google code scanner with auto-zoom on Android, VisionKit in
//   accurate mode on iPhone: see patches/expo-camera+*.patch), which finds the code anywhere in view.
// - A photo works too, read at full quality: a picture of the card, or an e-Aadhaar screenshot.
// - After a few seconds without a code: tips, and the smart scanner becomes the main button.
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { techHref, techStage } from '../../domain/techReview';
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

type Phase = 'SCAN' | 'CHECKING' | 'DONE';

/** In-app camera zoom steps (expo-camera's 0..1 scale): 1x, about 2x and about 3x. */
const ZOOMS = [0, 0.25, 0.45] as const;
/** Tips come up, and the smart scanner becomes the main button, when no Aadhaar code was read for this long. */
const SLOW_MS = 6000;

/** The Secure QR holds a long decimal number; anything else (a payment QR, a URL) is not an Aadhaar code. */
const looksLikeSecureQr = (data: string) => /^\d{200,}$/.test(data.trim());

const smartScanner = () => Platform.OS !== 'web' && CameraView.isModernBarcodeScannerAvailable;

export default function AadhaarScan() {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const { updateTech } = useAppState();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>(session.profile.aadhaar ? 'DONE' : 'SCAN');
  const [error, setError] = useState<unknown>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [result, setResult] = useState(session.profile.aadhaar ?? null);
  const handled = useRef(false);
  const [zoom, setZoom] = useState(0);
  const [torch, setTorch] = useState(false);
  const [slow, setSlow] = useState(false);
  // The registration step (profile submitted, Aadhaar not yet scanned), as opposed to opening it from the checking page.
  const [required] = useState(() => techStage(session.profile, Date.now()) === 'AADHAAR');
  // The next registration step: the skill check for a new technician, else "checking your details".
  const next = () => (required ? resetTo(techHref(session.profile, Date.now())) : router.back());
  const live = phase === 'SCAN' && Platform.OS !== 'web' && !!permission?.granted;

  // Ask for the camera at once the first time, so the camera opens without an extra tap.
  const asked = useRef(false);
  useEffect(() => {
    if (phase !== 'SCAN' || Platform.OS === 'web' || !permission || permission.granted || asked.current) return;
    if (!permission.canAskAgain) {
      setHint(t('aadhaar.cameraDenied'));
      return;
    }
    asked.current = true;
    void requestPermission().then((p) => {
      if (!p.granted) setHint(t('aadhaar.cameraDenied'));
    });
  }, [phase, permission, requestPermission, t]);

  useEffect(() => {
    if (!live) return undefined;
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [live]);

  // The smart scanner reports here; it is listened to only while this screen is open.
  const onScannedRef = useRef<(data: string) => void>(() => undefined);
  useEffect(() => {
    if (!smartScanner()) return undefined;
    const sub = CameraView.onModernBarcodeScanned((e) => onScannedRef.current(e.data));
    return () => sub.remove();
  }, []);

  const allowCamera = async () => {
    setHint(null);
    const p = await requestPermission();
    if (!p.granted) setHint(t('aadhaar.cameraDenied'));
  };

  /** The phone's own scanner (finds the code anywhere in view and zooms by itself). */
  const openSmartScanner = async () => {
    setError(null);
    setHint(null);
    setTorch(false);
    handled.current = false;
    try {
      await CameraView.launchScanner({ barcodeTypes: ['qr'], isGuidanceEnabled: true, isHighlightingEnabled: true });
    } catch {
      // Closed, or not available on this phone after all: the live camera stays.
    }
  };

  /** A photo of the code (a screenshot of the e-Aadhaar, or a picture of the card), read at full quality. */
  const fromPhoto = async (source: 'camera' | 'gallery') => {
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
      else setHint(t('aadhaar.noCodeInPhoto'));
    } catch {
      setHint(t('aadhaar.noCodeInPhoto'));
    }
  };

  const onScanned = async (data: string) => {
    if (handled.current) return;
    if (!looksLikeSecureQr(data)) {
      setHint(t('aadhaar.notSecureQr'));
      return;
    }
    if (Platform.OS === 'ios' && smartScanner()) void CameraView.dismissScanner().catch(() => undefined);
    handled.current = true;
    setTorch(false);
    feedback('pop');
    setPhase('CHECKING');
    try {
      const r = await backend.tech.verifyAadhaar(session.token, data.trim());
      setResult(r);
      updateTech(await backend.tech.me(session.token));
      feedback('success');
      setPhase('DONE');
    } catch (e) {
      handled.current = false;
      setError(e);
      setHint(isApiError(e, 'CONFLICT') ? t('aadhaar.inUse') : isApiError(e, 'VALIDATION') ? t('aadhaar.invalid') : null);
      setPhase('SCAN');
    }
  };
  onScannedRef.current = (data) => void onScanned(data);

  const zoomStep = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);

  return (
    <Screen
      testID="tech-aadhaar"
      wash={phase === 'DONE' ? 'mint' : 'sky'}
      header={<Header title={t('aadhaar.title')} back={!required} />}
      footer={phase === 'DONE' ? (
        <Button label={required ? t('common.continue') : t('common.done')} icon={required ? undefined : 'checkmark'} trailingIcon={required ? 'arrow-forward' : undefined} variant="lime" onPress={next} testID="aadhaar-done" />
      ) : phase === 'SCAN' ? (
        <>
          {smartScanner() ? (
            <Button label={t('aadhaar.smart')} icon="scan" variant={slow ? 'primary' : 'secondary'} onPress={() => void openSmartScanner()} testID="aadhaar-scan" />
          ) : null}
          <View style={styles.photoRow}>
            <Button label={t('aadhaar.takePhoto')} icon="camera" variant="ghost" size="md" style={styles.flex} onPress={() => void fromPhoto('camera')} disabled={Platform.OS === 'web'} testID="aadhaar-take-photo" />
            <Button label={t('aadhaar.screenshot')} icon="image" variant="ghost" size="md" style={styles.flex} onPress={() => void fromPhoto('gallery')} disabled={Platform.OS === 'web'} testID="aadhaar-photo" />
          </View>
        </>
      ) : undefined}
    >
      {phase === 'SCAN' ? (
        <>
          {required ? <Banner tone="info" icon="shield-checkmark" text={t('aadhaar.required')} testID="aadhaar-required" /> : null}
          <View style={styles.cameraFrame}>
            {live ? (
              // autofocus "off" is continuous focus in expo-camera; the whole frame is searched, not just the corners.
              <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} autofocus="off"
                zoom={zoom} enableTorch={torch} onBarcodeScanned={(r) => onScannedRef.current(r.data)} testID="aadhaar-camera" />
            ) : (
              <View style={styles.cameraOff}>
                <Art3D name="shield" size={88} float />
                {Platform.OS === 'web' ? (
                  <Txt variant="callout" color="onNavy" align="center">{t('aadhaar.phoneOnly')}</Txt>
                ) : permission && !permission.granted ? (
                  <Button label={t('aadhaar.allowCamera')} icon="camera" variant="lime" size="md" onPress={() => void allowCamera()} testID="aadhaar-allow" />
                ) : null}
              </View>
            )}
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <View key={c} style={[styles.corner, styles[c]]} pointerEvents="none" />)}
            {live ? (
              <View style={styles.camControls}>
                <Tap onPress={() => setTorch((v) => !v)} style={[styles.camBtn, torch && styles.camBtnOn]} accessibilityLabel={t('aadhaar.light')} accessibilityState={{ selected: torch }} testID="aadhaar-torch">
                  <Icon name={torch ? 'flashlight' : 'flashlight-outline'} size={20} color={torch ? 'onLime' : 'onNavy'} />
                </Tap>
                <Tap onPress={() => setZoom(ZOOMS[(zoomStep + 1) % ZOOMS.length] ?? 0)} style={[styles.camBtn, zoomStep > 0 && styles.camBtnOn]} accessibilityLabel={t('aadhaar.zoom')} testID="aadhaar-zoom">
                  <Txt variant="label" color={zoomStep > 0 ? 'onLime' : 'onNavy'}>{`${zoomStep + 1}x`}</Txt>
                </Tap>
              </View>
            ) : null}
          </View>
          <Txt variant="title3" align="center" heading>{t('aadhaar.pointCamera')}</Txt>
          {hint ? <Banner tone="warning" text={hint} testID="aadhaar-hint" />
            : slow ? <Banner tone="info" icon="bulb-outline" text={t('aadhaar.slowHint')} testID="aadhaar-slow" />
              : <Txt variant="footnote" color="inkMuted" align="center">{t('aadhaar.scanHint')}</Txt>}
          {!hint ? <ErrorBanner error={error} /> : null}
          <Banner tone="info" icon="lock-closed" text={t('aadhaar.privacy')} />
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
            {result.genderMatches === false ? (
              <View style={styles.step} testID="aadhaar-gender-differs">
                <Icon name="alert-circle" size={20} color="warning" />
                <Txt variant="callout" style={styles.flex}>{t('aadhaar.genderDiffers')}</Txt>
              </View>
            ) : null}
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', gap: space.lg, paddingVertical: space.xl },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  photoRow: { flexDirection: 'row', gap: space.sm },
  cameraFrame: { aspectRatio: 3 / 4, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#0B1240' },
  cameraOff: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
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
