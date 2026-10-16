// Sounds and vibration for the moments that matter: a booking confirmed, a quote arriving, a new job offer ringing,
// cash collected, an error. One call per moment: feedback('success'). Sounds respect the phone's silent switch (iOS) and
// both can be turned off in Account / Profile ("Sounds & vibration"). Sounds: Kenney "Interface Sounds" (CC0,
// assets/sounds/LICENSE-kenney-interface-sounds.txt), trimmed and levelled for the app.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';

export type Cue =
  /** Booking confirmed, payment done, job completed. */
  | 'success'
  /** A notification arrived (quote ready, technician on the way). */
  | 'notify'
  /** A new job offer for the technician: rings and vibrates in a pattern. */
  | 'offer'
  /** Cash received. */
  | 'cash'
  | 'error'
  /** Something was sent: quote, message. */
  | 'send'
  /** Something started or was picked (a small bubble). */
  | 'pop'
  | 'warning'
  /** Silent: a selection tick. */
  | 'select'
  /** Silent: a light tap. */
  | 'tap';

type SoundName = 'success' | 'notify' | 'offer' | 'cash' | 'error' | 'send' | 'pop';

const SOUNDS: Record<SoundName, number> = {
  success: require('../../assets/sounds/success.wav'),
  notify: require('../../assets/sounds/notify.wav'),
  offer: require('../../assets/sounds/offer.wav'),
  cash: require('../../assets/sounds/cash.wav'),
  error: require('../../assets/sounds/error.wav'),
  send: require('../../assets/sounds/send.wav'),
  pop: require('../../assets/sounds/pop.wav'),
};

const VOLUME: Record<SoundName, number> = { success: 0.75, notify: 0.7, offer: 1, cash: 0.75, error: 0.6, send: 0.5, pop: 0.45 };

let enabled = true;
let modeSet = false;
const players: Partial<Record<SoundName, AudioPlayer>> = {};
const haptics = Platform.OS !== 'web';

/** Follows the "Sounds & vibration" preference. */
export function setFeedbackEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopCue('offer');
}

function play(name: SoundName): void {
  try {
    if (!modeSet) {
      modeSet = true;
      // Short interface sounds: mix with other audio and stay quiet when the phone is on silent.
      void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
    }
    let p = players[name];
    if (!p) {
      p = createAudioPlayer(SOUNDS[name]);
      p.volume = VOLUME[name];
      players[name] = p;
    }
    void p.seekTo(0).catch(() => undefined);
    p.play();
  } catch {
    // Sound is a nicety; never let it break a screen.
  }
}

function buzz(cue: Cue): void {
  if (!haptics) return;
  const n = Haptics.NotificationFeedbackType;
  const i = Haptics.ImpactFeedbackStyle;
  const safe = (p: Promise<void>) => void p.catch(() => undefined);
  switch (cue) {
    case 'success':
    case 'cash':
      safe(Haptics.notificationAsync(n.Success));
      break;
    case 'error':
      safe(Haptics.notificationAsync(n.Error));
      break;
    case 'warning':
      safe(Haptics.notificationAsync(n.Warning));
      break;
    case 'notify':
      safe(Haptics.impactAsync(i.Medium));
      setTimeout(() => safe(Haptics.impactAsync(i.Light)), 140);
      break;
    case 'offer':
      // A ring you can feel in a pocket.
      if (Platform.OS === 'android') Vibration.vibrate([0, 380, 160, 380, 160, 380]);
      else [0, 320, 640].forEach((ms) => setTimeout(() => safe(Haptics.impactAsync(i.Heavy)), ms));
      break;
    case 'send':
    case 'tap':
      safe(Haptics.impactAsync(i.Light));
      break;
    case 'pop':
    case 'select':
      safe(Haptics.selectionAsync());
      break;
  }
}

export function feedback(cue: Cue): void {
  if (!enabled) return;
  buzz(cue);
  if (cue !== 'warning' && cue !== 'select' && cue !== 'tap') play(cue);
}

/** Stops a ringing sound early (e.g. the job offer ring once the technician answers). */
export function stopCue(cue: Cue): void {
  if (cue === 'offer' && Platform.OS === 'android') Vibration.cancel();
  const p = players[cue as SoundName];
  try {
    p?.pause();
  } catch {
    // ignore
  }
}
