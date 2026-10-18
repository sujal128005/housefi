// The brand moment: logo, "Housefi", "by Nexara9", the tagline, and living water rising from the bottom in the
// logo's cobalt, cyan and amber. Used for the first entry screen and for the startup recovery
// screen, so both feel like Housefi.
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { decorative } from '../illustrations/parts';
import { colors, space } from '../theme/tokens';
import { ByNexara, LogoMark } from './Logo';
import { Appear, Pop, useReducedMotion } from './motion';
import { useLayout } from './responsive';
import { Txt } from './Txt';
import { WAVE_W, waveFrame, type WaveFrame } from './waveMath';

export const TAGLINE = 'Home Help, Made Easy.';

/** Logo, name, endorsement and tagline, centred. */
export function BrandLockup({ compact = false }: { readonly compact?: boolean }) {
  const layout = useLayout();
  const mark = compact ? 96 : layout.tablet ? 176 : layout.compact ? 120 : 148;
  return (
    <View style={styles.lockup} collapsable={false} testID="brand-lockup">
      <Pop><View style={styles.markShadow}><LogoMark size={mark} /></View></Pop>
      <Appear delay={120} style={styles.center}>
        <Txt variant="hero" weight="extrabold" lang="en" style={[styles.word, { fontSize: mark * 0.36, lineHeight: mark * 0.42 }]}>Housefi</Txt>
        <ByNexara size={compact ? 'footnote' : 'callout'} />
      </Appear>
      <Appear delay={240}>
        <Txt variant={compact ? 'callout' : 'title3'} color="inkMuted" weight="medium" align="center" lang="en" testID="brand-tagline">{TAGLINE}</Txt>
      </Appear>
    </View>
  );
}

/**
 * Living water rising from the bottom: three Gerstner wave layers in the logo's cobalt and cyan, the amber crest from
 * the logo's swoosh, and a perspective mesh of points and lines on the water (ui/waveMath). Purely decorative; sits
 * behind the content. Only this small drawing re-renders, once per display frame; it pauses when the app is in the
 * background and holds still with "reduce motion".
 */
export function BrandWave({ height = 220 }: { readonly height?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  // The drawing keeps the box's real proportions, so the points stay round.
  const vh = width > 0 ? Math.round((WAVE_W * height) / width) : 0;
  const first = useMemo(() => (vh ? waveFrame(0, vh) : null), [vh]);
  const [frame, setFrame] = useState<WaveFrame | null>(null);

  useEffect(() => {
    if (!vh || reduce) return;
    let raf = 0;
    let last = 0;
    let clock = 0;
    const tick = (now: number) => {
      // Time only moves while the screen is drawing, so the water picks up where it left off.
      clock += Math.min(50, last ? now - last : 16) / 1000;
      last = now;
      setFrame(waveFrame(clock, vh));
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    if (AppState.currentState !== 'background') start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [vh, reduce]);

  const f = frame ?? first;
  return (
    <View pointerEvents="none" style={[styles.wave, { height }]} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {f ? (
        <Svg width="100%" height="100%" viewBox={`0 0 ${WAVE_W} ${vh}`} {...decorative}>
          <Defs>
            <LinearGradient id={`a${id}`} x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor="#0A3CF5" stopOpacity="0.30" />
              <Stop offset="0.6" stopColor="#00B2EE" stopOpacity="0.16" />
              <Stop offset="1" stopColor="#00B2EE" stopOpacity="0.02" />
            </LinearGradient>
            <LinearGradient id={`b${id}`} x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor="#1E86FF" stopOpacity="0.22" />
              <Stop offset="1" stopColor="#1E86FF" stopOpacity="0.02" />
            </LinearGradient>
            <LinearGradient id={`m${id}`} x1="0" y1="1" x2="1" y2="0.2">
              <Stop offset="0" stopColor="#06BFF8" stopOpacity="0.2" />
              <Stop offset="1" stopColor="#06BFF8" stopOpacity="0.03" />
            </LinearGradient>
            <LinearGradient id={`c${id}`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#FFB21C" stopOpacity="0.9" />
              <Stop offset="0.7" stopColor="#FF7A0A" stopOpacity="0.45" />
              <Stop offset="1" stopColor="#FF7A0A" stopOpacity="0" />
            </LinearGradient>
            {/* mesh: fades out towards the horizon */}
            <LinearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#1E63FF" stopOpacity="0" />
              <Stop offset="0.45" stopColor="#1E63FF" stopOpacity="0.16" />
              <Stop offset="1" stopColor="#0A3CF5" stopOpacity="0.34" />
            </LinearGradient>
            <LinearGradient id={`d${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#06BFF8" stopOpacity="0" />
              <Stop offset="0.4" stopColor="#06BFF8" stopOpacity="0.45" />
              <Stop offset="1" stopColor="#0A45F5" stopOpacity="0.7" />
            </LinearGradient>
          </Defs>
          <Path d={f.layers[0]} fill={`url(#b${id})`} />
          <Path d={f.layers[1]} fill={`url(#m${id})`} />
          <Path d={f.mesh} stroke={`url(#g${id})`} strokeWidth={0.6} fill="none" />
          <Path d={f.dots} fill={`url(#d${id})`} />
          <Path d={f.layers[2]} fill={`url(#a${id})`} />
          <Path d={f.crest} stroke={`url(#c${id})`} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : null}
    </View>
  );
}

/** Full-screen brand layout: lockup in the middle, wave at the bottom, `children` (buttons, message) below. */
export function BrandScreen({ children, testID }: { readonly children?: ReactNode; readonly testID?: string }) {
  return (
    <View style={styles.screen} testID={testID}>
      <BrandWave />
      <View style={styles.middle}><BrandLockup /></View>
      {children ? <View style={styles.bottom}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  bottom: { paddingHorizontal: space.xl, paddingBottom: space.x4, gap: space.md },
  lockup: { alignItems: 'center', gap: space.lg },
  center: { alignItems: 'center', gap: 2 },
  word: { color: colors.ink, letterSpacing: -0.8, marginTop: space.sm },
  markShadow: { shadowColor: '#0A3CF5', shadowOpacity: 0.28, shadowRadius: 28, shadowOffset: { width: 0, height: 16 }, elevation: 12, borderRadius: 40 },
  wave: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
