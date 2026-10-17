// The brand moment: logo, "Housefi", "by Nexara9", the tagline, and a soft flowing gradient rising from the
// bottom-left in the logo's cobalt, cyan and amber. Used for the first entry screen and for the startup recovery
// screen, so both feel like Housefi.
import { useId, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { decorative } from '../illustrations/parts';
import { colors, space } from '../theme/tokens';
import { ByNexara, LogoMark } from './Logo';
import { Appear, Pop } from './motion';
import { useLayout } from './responsive';
import { Txt } from './Txt';

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

/** Soft waves rising from the bottom-left corner. Purely decorative; sits behind the content. */
export function BrandWave({ height = 220 }: { readonly height?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View pointerEvents="none" style={[styles.wave, { height }]}>
      <Svg width="100%" height="100%" viewBox="0 0 400 220" preserveAspectRatio="none" {...decorative}>
        <Defs>
          <LinearGradient id={`a${id}`} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#0A3CF5" stopOpacity="0.30" />
            <Stop offset="0.6" stopColor="#00B2EE" stopOpacity="0.16" />
            <Stop offset="1" stopColor="#00B2EE" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id={`b${id}`} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#1E86FF" stopOpacity="0.22" />
            <Stop offset="1" stopColor="#1E86FF" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id={`c${id}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFB21C" stopOpacity="0.9" />
            <Stop offset="0.7" stopColor="#FF7A0A" stopOpacity="0.45" />
            <Stop offset="1" stopColor="#FF7A0A" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d="M0 220 L0 120 C 70 112, 120 150, 200 128 C 280 106, 330 70, 400 52 L400 220 Z" fill={`url(#b${id})`} />
        <Path d="M0 220 L0 158 C 80 150, 140 182, 230 160 C 300 142, 350 112, 400 104 L400 220 Z" fill={`url(#a${id})`} />
        <Path d="M0 150 C 80 142, 140 174, 230 152 C 300 134, 350 104, 400 96" stroke={`url(#c${id})`} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      </Svg>
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
