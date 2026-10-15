// 3D-style category objects (tap, bulb, AC, washer, spray bottle, hammer) and the demo "sample photos" used in place of
// real camera pictures.
import Svg, { Circle, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';
import type { CategoryArt as ArtName } from '../domain/types';
import { Ball, decorative, GroundShadow, Lin, PALETTE as P } from './parts';


export function CategoryArt({ name, size = 64 }: { readonly name: ArtName; readonly size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" {...decorative}>
      <Defs>
        <Lin id="chrome" from="#F5F7FB" to="#9DA7BD" x2="1" y2="1" />
        <Ball id="drop" light="#9CCBFF" dark="#2F66F0" />
        <Ball id="glow" light="#FFF3B0" dark="#FFB800" />
        <Lin id="white" from="#FFFFFF" to="#DDE3F0" />
        <Ball id="glass" light="#BFE0FF" dark="#3C74E6" />
        <Lin id="teal" from="#5FE0C0" to="#14A58A" />
        <Lin id="wood" from="#E9A36A" to="#B5682F" />
        <Lin id="metal" from="#C7CEDD" to="#6B7690" />
      </Defs>
      <GroundShadow cx={32} cy={58} rx={18} ry={3} opacity={0.12} />
      {name === 'faucet' ? (
        <G>
          <Rect x={8} y={20} width={10} height={20} rx={3} fill="url(#chrome)" />
          <Path d="M14 22 H38 C46 22 50 27 50 34 V38 H42 V34 C42 31 40 30 38 30 H14 Z" fill="url(#chrome)" />
          <Rect x={22} y={12} width={14} height={6} rx={3} fill={P.capDark} />
          <Rect x={27} y={16} width={4} height={7} fill="url(#chrome)" />
          <Path d="M46 42 C46 42 40 49 40 53 C40 56.5 42.7 59 46 59 C49.3 59 52 56.5 52 53 C52 49 46 42 46 42 Z" fill="url(#drop)" />
          <Circle cx={44} cy={52} r={1.6} fill="#FFFFFF" opacity={0.8} />
        </G>
      ) : null}
      {name === 'bulb' ? (
        <G>
          <Circle cx={32} cy={26} r={22} fill="#FFE27A" opacity={0.28} />
          <Path d="M32 8 C42 8 49 15 49 25 C49 32 45 36 42 39 C40 41 40 43 40 45 H24 C24 43 24 41 22 39 C19 36 15 32 15 25 C15 15 22 8 32 8 Z" fill="url(#glow)" />
          <Path d="M28 34 L32 26 L36 34" stroke="#E08A00" strokeWidth={2} fill="none" strokeLinecap="round" />
          <Rect x={23} y={45} width={18} height={10} rx={3} fill="url(#metal)" />
          <Path d="M24 48 H40 M24 52 H40" stroke="#5B6478" strokeWidth={1.4} />
          <Ellipse cx={25} cy={18} rx={4} ry={6} fill="#FFFFFF" opacity={0.6} transform="rotate(25 25 18)" />
        </G>
      ) : null}
      {name === 'ac' ? (
        <G>
          <Rect x={6} y={14} width={52} height={24} rx={8} fill="url(#white)" stroke="#D3DAEA" strokeWidth={1} />
          <Rect x={10} y={30} width={44} height={4} rx={2} fill="#C4CDE0" />
          <Circle cx={50} cy={20} r={2} fill={P.greenLight} />
          <Path d="M16 44 C18 48 14 50 16 54 M28 44 C30 48 26 50 28 54 M40 44 C42 48 38 50 40 54" stroke="#6FA6FF" strokeWidth={3} strokeLinecap="round" fill="none" />
        </G>
      ) : null}
      {name === 'washer' ? (
        <G>
          <Rect x={12} y={6} width={40} height={50} rx={8} fill="url(#white)" stroke="#D3DAEA" strokeWidth={1} />
          <Rect x={12} y={6} width={40} height={10} rx={6} fill="#E8ECF6" />
          <Circle cx={20} cy={11} r={2} fill={P.orangeDark} />
          <Circle cx={27} cy={11} r={2} fill="#8D97B0" />
          <Circle cx={32} cy={35} r={14} fill="#C9D3EA" />
          <Circle cx={32} cy={35} r={11} fill="url(#glass)" />
          <Path d="M24 36 C28 32 34 40 40 34" stroke="#FFFFFF" strokeWidth={2} fill="none" opacity={0.7} />
        </G>
      ) : null}
      {name === 'spray' ? (
        <G>
          <Path d="M22 26 H42 L46 54 C46 57 44 58 42 58 H22 C20 58 18 57 18 54 Z" fill="url(#teal)" />
          <Rect x={26} y={14} width={12} height={12} rx={2} fill="#FFFFFF" stroke="#D3DAEA" strokeWidth={1} />
          <Path d="M24 14 H44 V10 H30 C26 10 24 12 24 14 Z" fill="#F3F5FA" stroke="#D3DAEA" strokeWidth={1} />
          <Rect x={23} y={36} width={18} height={10} rx={2} fill="#FFFFFF" opacity={0.85} />
          <Circle cx={52} cy={12} r={4} fill="#BFE6FF" />
          <Circle cx={56} cy={22} r={2.6} fill="#BFE6FF" />
          <Circle cx={50} cy={24} r={2} fill="#D6EEFF" />
        </G>
      ) : null}
      {name === 'hammer' ? (
        <G rotation={-35} origin="32, 32">
          <Rect x={28} y={20} width={8} height={40} rx={4} fill="url(#wood)" />
          <Path d="M14 12 H44 C48 12 50 14 50 18 V22 C50 24 48 26 46 26 H14 C12 26 10 24 10 22 V16 C10 14 12 12 14 12 Z" fill="url(#metal)" />
          <Path d="M44 14 L54 10 L54 26 L44 24 Z" fill="#8892A8" />
          <Rect x={14} y={14} width={24} height={3} rx={1.5} fill="#FFFFFF" opacity={0.5} />
        </G>
      ) : null}
    </Svg>
  );
}

/** Demo stand-ins for customer photos (labelled "Sample photo" wherever shown). */
export function SamplePhoto({ n, size = 96 }: { readonly n: number; readonly size?: number | `${number}%` }) {
  const k = ((n - 1) % 4) + 1;
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" {...decorative}>
      <Defs>
        <Lin id="tile" from="#EAF2FF" to="#CFDDF5" />
        <Lin id="warm" from="#FFF3E3" to="#F2D9B8" />
        <Lin id="pipe" from="#EEF1F7" to="#9AA3B8" />
        <Ball id="drop" light="#9CCBFF" dark="#2F66F0" />
      </Defs>
      {k === 1 ? (
        <G>
          <Rect width={120} height={120} fill="url(#tile)" />
          {[30, 60, 90].map((v) => <Path key={v} d={`M0 ${v} H120 M${v} 0 V120`} stroke="#FFFFFF" strokeWidth={2} />)}
          <Rect x={0} y={50} width={120} height={16} fill="url(#pipe)" />
          <Rect x={54} y={46} width={14} height={24} rx={3} fill="#8A93A8" />
          <Path d="M61 76 C61 76 54 85 54 90 C54 94 57 97 61 97 C65 97 68 94 68 90 C68 85 61 76 61 76 Z" fill="url(#drop)" />
          <Ellipse cx={61} cy={112} rx={22} ry={4} fill="#2F66F0" opacity={0.25} />
        </G>
      ) : null}
      {k === 2 ? (
        <G>
          <Rect width={120} height={120} fill="url(#warm)" />
          <Path d="M14 70 H106 L96 100 C94 106 90 108 84 108 H36 C30 108 26 106 24 100 Z" fill="#FFFFFF" stroke="#D9DEEA" strokeWidth={2} />
          <Path d="M58 70 V36 C58 30 62 26 68 26 H80 V34 H68 V70" fill="url(#pipe)" />
          <Path d="M76 40 C76 40 71 47 71 50 C71 53 73 55 76 55 C79 55 81 53 81 50 C81 47 76 40 76 40 Z" fill="url(#drop)" />
        </G>
      ) : null}
      {k === 3 ? (
        <G>
          <Rect width={120} height={120} fill="#F4F1EA" />
          <Rect x={30} y={30} width={60} height={60} rx={10} fill="#FFFFFF" stroke="#D9DEEA" strokeWidth={2} />
          <Circle cx={50} cy={60} r={6} fill="#5B6478" />
          <Circle cx={70} cy={60} r={6} fill="#5B6478" />
          <Path d="M86 22 L78 40 L88 40 L80 58" stroke={P.yellow} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" fill="none" />
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
