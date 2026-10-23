// The skill check's work video, recorded live in the app: choose the camera, record 1 to 2 minutes (it stops by itself
// at 2:00), check the length, send. Recorded without sound (only the picture is reviewed) at 480p so it uploads on
// mobile data. A Housefi expert watches it and approves it for the trades it shows.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Art3D } from '../../illustrations/Art3D';
import { formatDuration } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { feedback } from '../../services/feedback';
import { useBackend } from '../../services/ServicesProvider';
import { useTechSession } from '../../state/AppState';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, ErrorBanner, Header, Icon, Screen, Tap, Txt } from '../../ui';

const MIN_SEC = 60;
const MAX_SEC = 120;

type Phase = 'READY' | 'RECORDING' | 'DONE';

export default function SkillVideo() {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [phase, setPhase] = useState<Phase>('READY');
  const [seconds, setSeconds] = useState(0);
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'web' && permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    if (phase !== 'RECORDING') return undefined;
    const tick = setInterval(() => setSeconds(Math.min(MAX_SEC, Math.floor((Date.now() - startedAt.current) / 1000))), 250);
    return () => clearInterval(tick);
  }, [phase]);

  const start = async () => {
    if (!camera.current) return;
    setError(null);
    setUri(null);
    setSeconds(0);
    startedAt.current = Date.now();
    setPhase('RECORDING');
    feedback('pop');
    try {
      // Resolves when stopped, or by itself at 2 minutes.
      const video = await camera.current.recordAsync({ maxDuration: MAX_SEC });
      const length = Math.round((Date.now() - startedAt.current) / 1000);
      setSeconds(Math.min(MAX_SEC, length));
      setUri(video?.uri ?? null);
      setPhase('DONE');
      feedback('success');
    } catch (e) {
      setError(e);
      setPhase('READY');
    }
  };

  const stop = () => camera.current?.stopRecording();

  const send = async () => {
    if (!uri) return;
    setBusy(true);
    setError(null);
    try {
      await backend.tech.sendSkillVideo(session.token, { source: 'LIVE', uri });
      feedback('success');
      router.back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const long = seconds >= MIN_SEC;
  const live = Platform.OS !== 'web' && !!permission?.granted;

  return (
    <Screen
      testID="tech-skill-video"
      header={<Header title={t('svideo.title')} back={phase !== 'RECORDING'} />}
      footer={phase === 'RECORDING' ? (
        <Button label={long ? t('svideo.stop') : t('svideo.min')} icon="stop" variant={long ? 'danger' : 'secondary'} disabled={!long} onPress={stop} testID="svideo-stop" />
      ) : phase === 'DONE' ? (
        <View style={styles.row}>
          <Button label={t('svideo.again')} icon="refresh" variant="outline" size="md" style={styles.flex} disabled={busy} onPress={() => setPhase('READY')} testID="svideo-again" />
          <Button label={t('svideo.send')} icon="send" size="md" style={styles.flex} disabled={!long || !uri} loading={busy} onPress={() => void send()} testID="svideo-send" />
        </View>
      ) : (
        <Button label={t('svideo.start')} icon="radio-button-on" variant="danger" disabled={!live} onPress={() => void start()} testID="svideo-start" />
      )}
    >
      <Txt variant="callout" color="inkMuted">{t('svideo.tips')}</Txt>
      <View style={styles.frame}>
        {live ? (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} mode="video" mute videoQuality="480p" testID="svideo-camera" />
        ) : (
          <View style={styles.off}>
            <Art3D name="camera" size={80} float />
            {Platform.OS === 'web' ? <Txt variant="callout" color="onNavy" align="center">{t('svideo.phoneOnly')}</Txt>
              : <Button label={t('svideo.allowCamera')} icon="camera" variant="lime" size="md" onPress={() => void requestPermission()} testID="svideo-allow" />}
          </View>
        )}
        {phase === 'RECORDING' || phase === 'DONE' ? (
          <View style={[styles.badge, phase === 'RECORDING' && styles.badgeLive]}>
            {phase === 'RECORDING' ? <View style={styles.recDot} /> : <Icon name="checkmark-circle" size={16} color="onNavy" />}
            <Txt variant="label" color="onNavy" testID="svideo-time">{phase === 'DONE' ? t('svideo.done', { time: formatDuration(seconds) }) : `${formatDuration(seconds)} / ${formatDuration(MAX_SEC)}`}</Txt>
          </View>
        ) : null}
        {live && phase === 'READY' ? (
          <Tap onPress={() => setFacing(facing === 'front' ? 'back' : 'front')} style={styles.flip} accessibilityLabel={t('svideo.flip')} testID="svideo-flip">
            <Icon name="camera-reverse" size={22} color="onNavy" />
          </Tap>
        ) : null}
      </View>
      {phase === 'DONE' && !long ? <Banner tone="warning" icon="alert-circle" text={t('skills.videoTooShort')} /> : null}
      <ErrorBanner error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: space.sm },
  frame: { aspectRatio: 3 / 4, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#0B1240' },
  off: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  badge: { position: 'absolute', top: space.md, left: space.md, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.55)' },
  badgeLive: { backgroundColor: colors.danger },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.onNavy },
  flip: { position: 'absolute', bottom: space.lg, right: space.lg, width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
});
