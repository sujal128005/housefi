import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { decorative } from '../illustrations/parts';
import { colors, space } from '../theme/tokens';
import { Txt } from './Txt';

export function LogoMark({ size = 40 }: { readonly size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" {...decorative}>
      <Defs>
        <LinearGradient id="m" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#2F4BA8" />
          <Stop offset="1" stopColor="#13235B" />
        </LinearGradient>
      </Defs>
      <Rect width={48} height={48} rx={14} fill="url(#m)" />
      <Path d="M12 23 L24 13 L36 23 V35 C36 36.1 35.1 37 34 37 H14 C12.9 37 12 36.1 12 35 Z" fill="#FFFFFF" />
      <Rect x={20.5} y={26} width={7} height={11} rx={2} fill="#2F66F0" />
      <Circle cx={36} cy={13} r={4} fill="#FFC93C" />
    </Svg>
  );
}

export function Logo({ size = 36 }: { readonly size?: number }) {
  return (
    <View style={styles.row} accessible accessibilityLabel="Housefi">
      <LogoMark size={size} />
      <View style={styles.word}>
        <Txt variant="title2" color="navy" weight="extrabold">House</Txt>
        <Txt variant="title2" color="blue" weight="extrabold">fi</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  word: { flexDirection: 'row' },
});

export const LOGO_BG = colors.navy;
