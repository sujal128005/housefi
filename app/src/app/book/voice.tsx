// Voice note: record up to 30 seconds with the microphone (live level meter and timer), play it back, and the AI
// writes down what was said (Telugu or English). The recording is uploaded once and goes with the booking, so the
// technician can also listen to it; the written note is added to the problem description.
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Art3D } from '../../illustrations/Art3D';
import { formatDuration } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { useBackend } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { colors, radius, shadow, space } from '../../theme/tokens';
import { Banner, Button, Card, Header, Icon, Screen, Tap, Txt } from '../../ui';
import { Appear, Pulse } from '../../ui/motion';
import { feedback } from '../../services/feedback';
import { useSingleFlight } from '../../ui/useSingleFlight';

/** Speech-to-text takes up to 30 seconds in one go; the API keeps longer notes as audio only. */
export const VOICE_MAX_SEC = 30;
const BARS = 32;
const MIN_SEC = 1;

type Phase = 'IDLE' | 'RECORDING' | 'RECORDED';
type Writing = { readonly state: 'WORKING' } | { readonly state: 'DONE'; readonly text: string; readonly audioId: string | null } | { readonly state: 'FAILED' };

/** -160..0 dB from the recorder → 0.15..1 bar height. */
const level = (db: number | undefined) => (db === undefined ? 0.3 : Math.max(0.15, Math.min(1, (db + 60) / 60)));

export default function VoiceNote() {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const { draft, setVoiceNote } = useDraft();
  const existing = draft.problem.voiceNote;
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const rec = useAudioRecorderState(recorder, 100);
  const [phase, setPhase] = useState<Phase>(existing ? 'RECORDED' : 'IDLE');
  const [uri, setUri] = useState<string | null>(existing?.uri ?? null);
  const [sec, setSec] = useState(existing?.durationSec ?? 0);
  const [wave, setWave] = useState<number[]>(() => Array.from({ length: BARS }, () => 0.2));
  const [denied, setDenied] = useState(false);
  const [writing, setWriting] = useState<Writing | null>(existing ? { state: 'DONE', text: existing.transcript, audioId: existing.audioId ?? null } : null);
  const player = useAudioPlayer(uri ? { uri } : null);
  const playback = useAudioPlayerStatus(player);
  const stopping = useRef(false);

  // The level meter: the newest level enters on the right.
  useEffect(() => {
    if (phase !== 'RECORDING') return;
    setWave((w) => [...w.slice(1), level(rec.metering)]);
    const elapsed = rec.durationMillis / 1000;
    setSec(elapsed);
    if (elapsed >= VOICE_MAX_SEC) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.durationMillis, rec.metering, phase]);

  // Once recorded: upload it and let the AI write it down.
  useEffect(() => {
    if (phase !== 'RECORDED' || !uri || writing) return;
    let alive = true;
    setWriting({ state: 'WORKING' });
    void backend.ai.transcribe(session.token, { uri, durationSec: Math.max(MIN_SEC, Math.round(sec)) }, draft.serviceId, locale).then(
      (r) => alive && setWriting({ state: 'DONE', text: r.text, audioId: r.audioId }),
      () => alive && setWriting({ state: 'FAILED' }),
    );
    return () => {
      alive = false;
    };
  }, [phase, uri, writing, backend, session.token, sec, draft.serviceId, locale]);

  // A quick double tap on the mic must not prepare the recorder twice (the second attempt fails).
  const starting = useSingleFlight();
  const start = () => starting(async () => {
    player.pause();
    const perm = await requestRecordingPermissionsAsync().catch(() => null);
    if (!perm?.granted) {
      setDenied(true);
      return;
    }
    setDenied(false);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      setWriting({ state: 'FAILED' });
      return;
    }
    stopping.current = false;
    setUri(null);
    setSec(0);
    setWriting(null);
    feedback('pop');
    setPhase('RECORDING');
  });

  async function stop(): Promise<void> {
    if (stopping.current) return;
    stopping.current = true;
    try {
      await recorder.stop();
    } catch {
      // The file may still be usable; checked below.
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    feedback('send');
    setSec((s) => Math.min(Math.max(s, MIN_SEC), VOICE_MAX_SEC));
    setUri(recorder.uri);
    setPhase('RECORDED');
  }

  const togglePlay = () => {
    if (playback.playing) player.pause();
    else {
      if (playback.didJustFinish || playback.currentTime >= (playback.duration || sec) - 0.1) void player.seekTo(0);
      player.play();
    }
  };

  const done = writing?.state === 'DONE' ? writing : null;
  const use = () => {
    if (!done || !uri) return;
    setVoiceNote({ durationSec: Math.max(MIN_SEC, Math.round(sec)), transcript: done.text, audioId: done.audioId, uri });
    router.back();
  };
  const progress = playback.duration > 0 ? playback.currentTime / playback.duration : 0;
  const shownSec = phase === 'RECORDED' && playback.playing ? playback.currentTime : sec;

  return (
    <Screen
      testID="voice"
      wash="sky"
      header={<Header title={t('voice.title')} />}
      footer={phase === 'RECORDED' ? (
        <>
          <Button label={t('voice.use')} icon="checkmark" onPress={use} disabled={!done} testID="voice-use" />
          <Button label={t('voice.redo')} icon="refresh" variant="outline" onPress={() => void start()} testID="voice-redo" />
        </>
      ) : undefined}
    >
      {denied ? <Banner tone="warning" text={t('voice.denied')} /> : null}
      <Txt variant="title2" align="center" heading>{t('voice.body')}</Txt>

      <View style={styles.stage}>
        <View style={styles.wave} accessibilityElementsHidden>
          {wave.map((h, k) => {
            const lit = phase === 'RECORDING' || (phase === 'RECORDED' && playback.playing && k / BARS <= progress);
            return <View key={k} style={[styles.bar, { height: 10 + h * 54, backgroundColor: lit ? colors.blue : colors.lineStrong }]} />;
          })}
        </View>
        <Txt variant="hero" align="center" testID="voice-timer" accessibilityLiveRegion="polite">{formatDuration(Math.floor(shownSec))}</Txt>
        <Txt variant="footnote" color={phase === 'RECORDING' ? 'danger' : 'inkMuted'} align="center">
          {phase === 'IDLE' ? `${t('voice.tapToStart')} · ${t('voice.max')}` : phase === 'RECORDING' ? t('voice.recording') : `${t('voice.recorded')} · ${t('voice.max')}`}
        </Txt>

        <View style={styles.micWrap}>
          {phase === 'RECORDING' ? <Pulse size={120} color={colors.danger} /> : null}
          {phase === 'IDLE' ? (
            <Tap onPress={() => void start()} style={styles.mic} haptic accessibilityLabel={t('book.issue.speak')} testID="voice-start">
              <Icon name="mic" size={40} color="onNavy" />
            </Tap>
          ) : null}
          {phase === 'RECORDING' ? (
            <Tap onPress={() => void stop()} style={[styles.mic, styles.micStop]} haptic accessibilityLabel={t('voice.stop')} testID="voice-stop">
              <View style={styles.stopSquare} />
            </Tap>
          ) : null}
          {phase === 'RECORDED' ? (
            <Tap onPress={togglePlay} style={[styles.mic, styles.micPlay]} haptic accessibilityLabel={playback.playing ? t('voice.pause') : t('voice.play')} testID="voice-play" disabled={!uri}>
              <Icon name={playback.playing ? 'pause' : 'play'} size={36} color="onNavy" />
            </Tap>
          ) : null}
        </View>
      </View>

      {phase === 'RECORDED' && writing ? (
        <Appear>
          <Card style={styles.transcript} testID="voice-transcript">
            <View style={styles.row}>
              <Art3D name="robot" size={30} />
              <Txt variant="label" color="blue" style={styles.flex}>{t('voice.aiWriting')}</Txt>
            </View>
            {writing.state === 'WORKING' ? (
              <View style={styles.row}><ActivityIndicator color={colors.blue} /><Txt variant="footnote" color="inkMuted">{t('voice.listening')}</Txt></View>
            ) : writing.state === 'FAILED' ? (
              <Txt variant="footnote" color="danger" testID="voice-failed">{t('voice.failed')}</Txt>
            ) : writing.text ? (
              <Txt variant="callout">“{writing.text}”</Txt>
            ) : (
              <Txt variant="footnote" color="inkMuted" testID="voice-audio-only">{t('voice.audioOnly')}</Txt>
            )}
          </Card>
        </Appear>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stage: { alignItems: 'center', gap: space.md, paddingVertical: space.lg },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 72 },
  bar: { width: 5, borderRadius: 3 },
  micWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', marginTop: space.sm },
  mic: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', ...shadow.button },
  micStop: { backgroundColor: colors.danger },
  micPlay: { backgroundColor: colors.blue },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.surface },
  transcript: { gap: space.sm, borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
