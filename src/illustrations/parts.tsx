// Shared bits for the vector illustrations: two-stop gradients and the soft ground shadow that gives the "3D toy"
// look of the reference (light from the top left, a soft shadow below).
import { Platform } from 'react-native';
import { Ellipse, LinearGradient, RadialGradient, Stop } from 'react-native-svg';

/** Hides decorative art from screen readers (native props on phones, aria-hidden on the web preview). */
export const decorative = Platform.OS === 'web'
  ? ({ 'aria-hidden': true } as Record<string, unknown>)
  : ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as Record<string, unknown>);

export function Lin({ id, from, to, x1 = '0', y1 = '0', x2 = '0', y2 = '1' }: { readonly id: string; readonly from: string; readonly to: string; readonly x1?: string; readonly y1?: string; readonly x2?: string; readonly y2?: string }) {
  return (
    <LinearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
      <Stop offset="0" stopColor={from} />
      <Stop offset="1" stopColor={to} />
    </LinearGradient>
  );
}

/** Radial "sphere" shading: bright spot up-left, darker rim. */
export function Ball({ id, light, dark }: { readonly id: string; readonly light: string; readonly dark: string }) {
  return (
    <RadialGradient id={id} cx="0.38" cy="0.32" r="0.75" fx="0.32" fy="0.26">
      <Stop offset="0" stopColor={light} />
      <Stop offset="1" stopColor={dark} />
    </RadialGradient>
  );
}

export function GroundShadow({ cx, cy, rx, ry = 7, opacity = 0.13 }: { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry?: number; readonly opacity?: number }) {
  return <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#1B2A6B" opacity={opacity} />;
}

export const PALETTE = {
  skinLight: '#FFD8B8',
  skinDark: '#E8A177',
  hair: '#3A2416',
  uniformLight: '#4D88FF',
  uniformDark: '#1F4ED0',
  capLight: '#5590FF',
  capDark: '#1D49C4',
  brim: '#173DA6',
  yellow: '#FFC93C',
  orangeLight: '#FFA25A',
  orangeDark: '#EE5F24',
  greenLight: '#47D98A',
  greenDark: '#14A058',
  steelLight: '#F2F4F8',
  steelDark: '#9AA3B8',
  navy: '#13235B',
  white: '#FFFFFF',
} as const;
