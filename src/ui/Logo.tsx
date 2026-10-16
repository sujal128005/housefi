// The Housefi logo: the finalized brand mark (assets/brand/housefi-logo.png, cut from the master file without
// redrawing) and the "Housefi" wordmark, with the optional "by Nexara9" endorsement (the 9 in Nexara gold).
import { Image, StyleSheet, View } from 'react-native';
import { colors, space } from '../theme/tokens';
import { Txt } from './Txt';

const MARK = require('../../assets/brand/housefi-logo.png');

/** The brand mark alone (rounded tile). */
export function LogoMark({ size = 40 }: { readonly size?: number }) {
  return <Image source={MARK} style={{ width: size, height: size }} resizeMode="contain" accessibilityIgnoresInvertColors />;
}

/** "by Nexara9": small and quiet, the 9 in gold. */
export function ByNexara({ size = 'footnote' }: { readonly size?: 'footnote' | 'callout' | 'label' }) {
  return (
    <View style={styles.by} accessible accessibilityLabel="by Nexara9">
      <Txt variant={size} color="inkMuted" weight="medium" lang="en">by </Txt>
      <Txt variant={size} color="ink" weight="semibold" lang="en" style={styles.tracked}>Nexara</Txt>
      <Txt variant={size} color="gold" weight="extrabold" lang="en">9</Txt>
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
  by: { flexDirection: 'row', alignItems: 'baseline' },
  tracked: { letterSpacing: 0.6 },
});

export const LOGO_BG = colors.navy;
