// Demo stand-ins for customer photos (labelled "Sample photo" wherever shown). Gradient ids are unique per drawing so
// several can share a page (the web preview resolves SVG ids page-wide).
import { useId } from 'react';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { decorative } from './parts';

export const SAMPLE_PHOTOS = [1, 2, 3, 4] as const;

export function SamplePhoto({ n, size = 96 }: { readonly n: number; readonly size?: number | `${number}%` }) {
  const u = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = ((n - 1) % 4) + 1;
  const tile = `tile${u}`;
  const warm = `warm${u}`;
  const pipe = `pipe${u}`;
  const drop = `drop${u}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" {...decorative}>
      <Defs>
        <LinearGradient id={tile} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#EAF2FF" /><Stop offset="1" stopColor="#CFDDF5" /></LinearGradient>
        <LinearGradient id={warm} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FFF3E3" /><Stop offset="1" stopColor="#F2D9B8" /></LinearGradient>
        <LinearGradient id={pipe} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#EEF1F7" /><Stop offset="1" stopColor="#9AA3B8" /></LinearGradient>
        <RadialGradient id={drop} cx="0.38" cy="0.32" r="0.75"><Stop offset="0" stopColor="#9CCBFF" /><Stop offset="1" stopColor="#2F66F0" /></RadialGradient>
      </Defs>
      {k === 1 ? (
        <G>
          <Rect width={120} height={120} fill={`url(#${tile})`} />
          {[30, 60, 90].map((v) => <Path key={v} d={`M0 ${v} H120 M${v} 0 V120`} stroke="#FFFFFF" strokeWidth={2} />)}
          <Rect x={0} y={50} width={120} height={16} fill={`url(#${pipe})`} />
          <Rect x={54} y={46} width={14} height={24} rx={3} fill="#8A93A8" />
          <Path d="M61 76 C61 76 54 85 54 90 C54 94 57 97 61 97 C65 97 68 94 68 90 C68 85 61 76 61 76 Z" fill={`url(#${drop})`} />
          <Ellipse cx={61} cy={112} rx={22} ry={4} fill="#2F66F0" opacity={0.25} />
        </G>
      ) : null}
      {k === 2 ? (
        <G>
          <Rect width={120} height={120} fill={`url(#${warm})`} />
          <Path d="M14 70 H106 L96 100 C94 106 90 108 84 108 H36 C30 108 26 106 24 100 Z" fill="#FFFFFF" stroke="#D9DEEA" strokeWidth={2} />
          <Path d="M58 70 V36 C58 30 62 26 68 26 H80 V34 H68 V70" fill={`url(#${pipe})`} />
          <Path d="M76 40 C76 40 71 47 71 50 C71 53 73 55 76 55 C79 55 81 53 81 50 C81 47 76 40 76 40 Z" fill={`url(#${drop})`} />
        </G>
      ) : null}
      {k === 3 ? (
        <G>
          <Rect width={120} height={120} fill="#F4F1EA" />
          <Rect x={30} y={30} width={60} height={60} rx={10} fill="#FFFFFF" stroke="#D9DEEA" strokeWidth={2} />
          <Circle cx={50} cy={60} r={6} fill="#5B6478" />
          <Circle cx={70} cy={60} r={6} fill="#5B6478" />
          <Path d="M86 22 L78 40 L88 40 L80 58" stroke="#FFC93C" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" fill="none" />
        </G>
      ) : null}
      {k === 4 ? (
        <G>
          <Rect width={120} height={120} fill="#F3EEE6" />
          <Path d="M30 40 C40 26 70 30 76 44 C84 40 96 50 92 62 C100 72 88 90 72 86 C62 98 36 92 36 78 C22 74 20 50 30 40 Z" fill="#C9B79A" opacity={0.8} />
          <Path d="M42 52 C50 46 62 50 64 60 C66 70 52 74 46 68 C40 64 38 56 42 52 Z" fill="#A89270" opacity={0.7} />
          <Rect x={0} y={104} width={120} height={16} fill="#E2D8C8" />
        </G>
      ) : null}
    </Svg>
  );
}
