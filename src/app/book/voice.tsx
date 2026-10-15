// Voice note (simulated in demo): record with a live waveform and timer, play back, then use or record again.
// No microphone is used in this build; the recording and transcript are labelled as samples.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatDuration } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { useDraft } from '../../state/BookingDraft';
import { colors, radius, shadow, space } from '../../theme/tokens';
import { Banner, Button, Card, Header, Icon, Screen, Tap, Txt } from '../../ui';

const MAX_SEC = 60;
const BARS = 32;

type Phase = 'IDLE' | 'RECORDING' | 'RECORDED';

function randomBars(seed: number): number[] {
  return Array.from({ length: BARS }, (_, k) => 0.25 + Math.abs(Math.sin(seed * 0.9 + k * 1.7)) * 0.75);
}

export default function VoiceNote() {
  const { t } = useI18n();
  const { draft, setVoiceNote } = useDraft();
  const existing = draft.problem.voiceNote;
  const [phase, setPhase] = useState<Phase>(existing ? 'RECORDED' : 'IDLE');
  const [sec, setSec] = useState(existing?.durationSec ?? 0);
  const [bars, setBars] = useState(() => randomBars(3));
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const tick = useRef(0);

  useEffect(() => {
    if (phase !== 'RECORDING') return;
    const id = setInterval(() => {
      tick.current += 1;
      setBars(randomBars(tick.current));
      if (tick.current % 8 === 0) {
        setSec((s) => {
          if (s + 1 >= MAX_SEC) setPhase('RECORDED');
          return Math.min(s + 1, MAX_SEC);
        });
      }
    }, 125);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setPos((p) => {
        if (p + 0.25 >= sec) {
          setPlaying(false);
          return 0;
        }
        return p + 0.25;
      });
    }, 250);
    return () => clearInterval(id);
  }, [playing, sec]);

  const start = () => {
    setSec(0);
    setPos(0);
    setPlaying(false);
    tick.current = 0;
    setPhase('RECORDING');
  };
  const stop = () => {
    setSec((s) => Math.max(s, 3));
    setPhase('RECORDED');
  };
  const use = () => {
    setVoiceNote({ durationSec: sec, simulated: true });
    router.back();
  };
  const progress = sec > 0 ? pos / sec : 0;

  return (
    <Screen
      testID="voice"
      wash="sky"
      header={<Header title={t('voice.title')} />}
      footer={phase === 'RECORDED' ? (
        <>
          <Button label={t('voice.use')} icon="checkmark" onPress={use} testID="voice-use" />
          <Button label={t('voice.redo')} icon="refresh" variant="outline" onPress={start} testID="voice-redo" />
        </>
      ) : undefined}
    >
      <Banner tone="demo" text={t('voice.demo')} />
      <Txt variant="title2" align="center" heading>{t('voice.body')}</Txt>

      <View style={styles.stage}>
        <View style={styles.wave} accessibilityElementsHidden>
          {bars.map((h, k) => {
            const lit = phase === 'RECORDING' || (phase === 'RECORDED' && k / BARS <= progress && playing);
            return <View key={k} style={[styles.bar, { height: 10 + h * 54, backgroundColor: lit ? colors.blue : colors.lineStrong }]} />;
          })}
        </View>
        <Txt variant="hero" align="center" testID="voice-timer" accessibilityLiveRegion="polite">
          {formatDuration(phase === 'RECORDED' && playing ? pos : sec)}
        </Txt>
        <Txt variant="footnote" color={phase === 'RECORDING' ? 'danger' : 'inkMuted'} align="center">
          {phase === 'IDLE' ? t('voice.tapToStart') : phase === 'RECORDING' ? t('voice.recording') : `${t('voice.recorded')} · ${t('voice.max')}`}
        </Txt>

        {phase === 'IDLE' ? (
          <Tap onPress={start} style={styles.mic} haptic accessibilityLabel={t('book.issue.speak')} testID="voice-start">
            <Icon name="mic" size={40} color="onNavy" />
          </Tap>
        ) : null}
        {phase === 'RECORDING' ? (
          <Tap onPress={stop} style={[styles.mic, styles.micStop]} haptic accessibilityLabel={t('voice.stop')} testID="voice-stop">
            <View style={styles.stopSquare} />
          </Tap>
        ) : null}
        {phase === 'RECORDED' ? (
          <Tap onPress={() => setPlaying((p) => !p)} style={[styles.mic, styles.micPlay]} haptic accessibilityLabel={playing ? t('voice.pause') : t('voice.play')} testID="voice-play">
            <Icon name={playing ? 'pause' : 'play'} size={36} color="onNavy" />
          </Tap>
        ) : null}
      </View>

      {phase === 'RECORDED' ? (
        <Card style={styles.transcript}>
          <View style={styles.row}>
            <Icon name="document-text-outline" size={18} color="demo" />
            <Txt variant="caption" color="demo">{t('voice.transcript')}</Txt>
          </View>
          <Txt variant="callout" color="ink">“{t('voice.transcriptText')}”</Txt>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', gap: space.md, paddingVertical: space.lg },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 72 },
  bar: { width: 5, borderRadius: 3 },
  mic: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginTop: space.md, ...shadow.button },
  micStop: { backgroundColor: colors.danger },
  micPlay: { backgroundColor: colors.blue },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.surface },
  transcript: { gap: space.sm, borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
