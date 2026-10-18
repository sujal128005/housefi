// Plays a booking's voice note (the customer's recording, from a short-lived signed URL).
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { StyleSheet, View } from 'react-native';
import { formatDuration } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { colors, radius, space } from '../theme/tokens';
import { Icon } from './Icon';
import { Tap } from './Tap';
import { Txt } from './Txt';

export function VoicePlayer({ uri, durationSec, testID }: { readonly uri: string; readonly durationSec: number; readonly testID?: string }) {
  const { t } = useI18n();
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const toggle = () => {
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.1)) void player.seekTo(0);
      player.play();
    }
  };
  const total = status.duration > 0 ? status.duration : durationSec;
  return (
    <Tap onPress={toggle} style={styles.row} accessibilityRole="button" accessibilityLabel={status.playing ? t('voice.pause') : t('voice.play')} testID={testID ?? 'voice-player'}>
      <View style={styles.btn}><Icon name={status.playing ? 'pause' : 'play'} size={18} color="onNavy" /></View>
      <View style={styles.track}><View style={[styles.fill, { width: `${total > 0 ? Math.min(100, (status.currentTime / total) * 100) : 0}%` }]} /></View>
      <Txt variant="label" color="inkMuted">{formatDuration(Math.round(status.playing ? status.currentTime : total))}</Txt>
    </Tap>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  btn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 4, borderRadius: radius.sm, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.blue },
});
