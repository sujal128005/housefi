// The Housefi logo: the finalized brand mark (assets/brand/housefi-logo.png, cut from the master file without
// redrawing) and the "Housefi" wordmark, with the "by NEXARA9" endorsement: Nexara9's own wordmark (wide capitals,
// gold gradient), which opens https://nexara9.me/ when tapped.
import { Image, Linking, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { space } from '../theme/tokens';
import { Tap } from './Tap';
import { Txt } from './Txt';

const MARK = require('../../assets/brand/housefi-logo.png');

/** Nexara9's website. A fixed https address: nothing from data or links is ever opened here. */
export const NEXARA9_URL = 'https://nexara9.me/';

/** The brand mark alone (rounded tile). */
export function LogoMark({ size = 40 }: { readonly size?: number }) {
  return <Image source={MARK} style={{ width: size, height: size }} resizeMode="contain" accessibilityIgnoresInvertColors />;
}

/** Gold, light to deep to light, as in the Nexara9 wordmark. `onDark` is the bright version for blue / dark grounds. */
const GOLD = {
  onDark: ['#F6E7AE', '#D7B25C', '#A88330', '#E9CF86'],
  onLight: ['#C9A24A', '#A27A26', '#7E5E1A', '#B8913A'],
} as const;

export function openNexara9(): void {
  void Linking.openURL(NEXARA9_URL).catch(() => undefined);
}

/** "NEXARA9" in Nexara9's style: wide spaced capitals with a gold gradient. Tapping opens nexara9.me. */
export function Nexara9Mark({ height = 14, tone = 'onLight', testID }: {
  /** Cap height in pt. */
  readonly height?: number;
  readonly tone?: keyof typeof GOLD;
  readonly testID?: string;
}) {
  const fontSize = Math.round(height * 1.38);
  const spacing = fontSize * 0.42;
  // Syncopate's capitals are about 0.92 em wide; seven letters plus the spacing between them.
  const width = Math.ceil(fontSize * 0.92 * 7 + spacing * 6 + 2);
  const h = Math.ceil(fontSize * 1.05);
  const [a, b, c, d] = GOLD[tone];
  const id = `nx9-${tone}`;
  return (
    <Tap onPress={openNexara9} accessibilityRole="link" accessibilityLabel="Nexara9, opens nexara9.me" hitSlop={8} scale={0.97} testID={testID}>
      <Svg width={width} height={h} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={a} />
            <Stop offset="0.45" stopColor={b} />
            <Stop offset="0.7" stopColor={c} />
            <Stop offset="1" stopColor={d} />
          </LinearGradient>
        </Defs>
        <SvgText x={1} y={fontSize * 0.86} fill={`url(#${id})`} fontFamily="Syncopate_700Bold" fontSize={fontSize} letterSpacing={spacing}>NEXARA9</SvgText>
      </Svg>
    </Tap>
  );
}

/** "by NEXARA9": a small "by" and Nexara9's wordmark (tappable). */
export function ByNexara({ size = 'footnote', tone = 'onLight' }: { readonly size?: 'caption' | 'footnote' | 'callout' | 'label'; readonly tone?: keyof typeof GOLD }) {
  const cap = size === 'callout' ? 13 : size === 'label' ? 12 : size === 'caption' ? 9 : 11;
  return (
    <View style={styles.by}>
      <Txt variant={size} color={tone === 'onDark' ? 'onNavyMuted' : 'inkMuted'} weight="medium" lang="en">by</Txt>
      <Nexara9Mark height={cap} tone={tone} testID="nexara9-link" />
    </View>
  );
}

/** Mark + wordmark, for headers. */
export function Logo({ size = 36 }: { readonly size?: number }) {
  return (
    <View style={styles.row} accessible accessibilityLabel="Housefi">
      <LogoMark size={size} />
      <Txt variant="title2" color="ink" weight="extrabold" lang="en">Housefi</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  by: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
