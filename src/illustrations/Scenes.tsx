// Scene illustrations for key moments: welcome house, language globe, phone sign-in, booking confirmed calendar,
// searching map, scooter (technician on the way), success badge, empty box, no-technician clock, address pin.
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';
import { Ball, decorative, GroundShadow, Lin, PALETTE as P } from './parts';


export function HouseArt({ size = 240 }: { readonly size?: number }) {
  return (
    <Svg width={size} height={size * 0.84} viewBox="0 0 240 200" {...decorative}>
      <Defs>
        <Lin id="wall" from="#FFF6E8" to="#F6DDBA" />
        <Lin id="side" from="#F0CFA3" to="#DDB283" />
        <Lin id="roof" from="#FF8A4C" to="#E2552A" />
        <Lin id="roofSide" from="#D9532B" to="#B8401E" />
        <Lin id="glass" from="#CFE4FF" to="#7FB0FF" />
        <Lin id="door" from="#2F66F0" to="#1B3FA8" />
        <Ball id="bush" light="#7BE3A4" dark="#1E9E5A" />
        <Ball id="lawn" light="#C9F2D8" dark="#8ED9AE" />
      </Defs>
      <Ellipse cx={120} cy={178} rx={110} ry={18} fill="url(#lawn)" />
      <GroundShadow cx={124} cy={170} rx={78} ry={8} opacity={0.16} />
      {/* side wall */}
      <Path d="M168 98 L204 84 L204 160 L168 170 Z" fill="url(#side)" />
      <Path d="M150 48 L190 36 L214 86 L168 102 Z" fill="url(#roofSide)" />
      {/* chimney */}
      <Rect x={170} y={34} width={14} height={30} rx={3} fill="#C9502A" />
      <Rect x={167} y={30} width={20} height={7} rx={3} fill="#A8401F" />
      {/* front wall and roof */}
      <Rect x={58} y={96} width={112} height={74} rx={4} fill="url(#wall)" />
      <Path d="M44 102 L114 40 L184 102 C186 104 184 108 180 108 L48 108 C44 108 42 104 44 102 Z" fill="url(#roof)" />
      <Path d="M114 40 L184 102" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={3} />
      <Circle cx={114} cy={78} r={11} fill="url(#glass)" stroke="#FFFFFF" strokeWidth={3} />
      {/* door */}
      <Rect x={98} y={124} width={32} height={46} rx={8} fill="url(#door)" />
      <Circle cx={123} cy={148} r={2.6} fill={P.yellow} />
      <Rect x={94} y={168} width={40} height={6} rx={3} fill="#E3C9A6" />
      {/* windows */}
      <Rect x={68} y={118} width={22} height={22} rx={5} fill="url(#glass)" stroke="#FFFFFF" strokeWidth={3} />
      <Path d="M79 118 V140 M68 129 H90" stroke="#FFFFFF" strokeWidth={2.5} />
      <Rect x={138} y={118} width={22} height={22} rx={5} fill="url(#glass)" stroke="#FFFFFF" strokeWidth={3} />
      <Path d="M149 118 V140 M138 129 H160" stroke="#FFFFFF" strokeWidth={2.5} />
      <Path d="M71 122 L76 122" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
      {/* bushes */}
      <Circle cx={50} cy={162} r={16} fill="url(#bush)" />
      <Circle cx={68} cy={168} r={11} fill="url(#bush)" />
      <Circle cx={196} cy={164} r={14} fill="url(#bush)" />
      <Circle cx={180} cy={170} r={9} fill="url(#bush)" />
      {/* sparkles */}
      <Sparkle x={30} y={56} s={1} color={P.yellow} />
      <Sparkle x={214} y={40} s={0.8} color="#7FB0FF" />
      <Sparkle x={60} y={30} s={0.6} color={P.orangeLight} />
    </Svg>
  );
}

export function Sparkle({ x, y, s, color }: { readonly x: number; readonly y: number; readonly s: number; readonly color: string }) {
  return <Path d={`M${x} ${y - 10 * s} Q${x + 2 * s} ${y - 2 * s} ${x + 10 * s} ${y} Q${x + 2 * s} ${y + 2 * s} ${x} ${y + 10 * s} Q${x - 2 * s} ${y + 2 * s} ${x - 10 * s} ${y} Q${x - 2 * s} ${y - 2 * s} ${x} ${y - 10 * s} Z`} fill={color} />;
}

export function GlobeArt({ size = 200 }: { readonly size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" {...decorative}>
      <Defs>
        <Ball id="sea" light="#8CC0FF" dark="#2457D6" />
        <Ball id="land" light="#8BF0B3" dark="#21A862" />
        <ClipPath id="clip"><Circle cx={100} cy={100} r={62} /></ClipPath>
        <ClipPath id="front"><Rect x={0} y={100} width={200} height={40} /></ClipPath>
      </Defs>
      <GroundShadow cx={100} cy={184} rx={52} />
      <Ellipse cx={100} cy={100} rx={86} ry={30} fill="none" stroke={P.yellow} strokeWidth={5} transform="rotate(-18 100 100)" opacity={0.9} />
      <Circle cx={100} cy={100} r={62} fill="url(#sea)" />
      <G clipPath="url(#clip)">
        <Path d="M54 70 C66 56 86 58 92 70 C98 82 84 86 88 98 C92 110 74 116 64 106 C54 96 44 82 54 70 Z" fill="url(#land)" />
        <Path d="M112 56 C126 50 148 60 152 76 C156 92 140 92 132 100 C124 108 128 124 114 128 C102 116 116 104 108 92 C100 80 98 62 112 56 Z" fill="url(#land)" />
        <Path d="M80 132 C92 126 110 134 112 148 C100 160 82 156 76 146 C72 140 74 136 80 132 Z" fill="url(#land)" />
      </G>
      <Ellipse cx={78} cy={70} rx={20} ry={11} fill="#FFFFFF" opacity={0.28} transform="rotate(-30 78 70)" />
      {/* front half of the ring passes in front of the globe */}
      <G transform="rotate(-18 100 100)">
        <G clipPath="url(#front)">
          <Ellipse cx={100} cy={100} rx={86} ry={30} fill="none" stroke={P.yellow} strokeWidth={5} />
        </G>
      </G>
      <Sparkle x={170} y={44} s={0.9} color={P.yellow} />
      <Sparkle x={34} y={52} s={0.6} color="#B7A3FF" />
    </Svg>
  );
}

export function PhoneArt({ size = 180 }: { readonly size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" {...decorative}>
      <Defs>
        <Lin id="body" from="#2A3F86" to="#101B47" />
        <Lin id="bubble" from="#5A8CFF" to="#2F66F0" />
        <Ball id="shield" light={P.greenLight} dark={P.greenDark} />
      </Defs>
      <GroundShadow cx={100} cy={186} rx={50} />
      <Rect x={58} y={20} width={86} height={160} rx={22} fill="url(#body)" />
      <Rect x={66} y={32} width={70} height={136} rx={14} fill="#F4F7FF" />
      <Rect x={88} y={25} width={26} height={4} rx={2} fill="#3B4F96" />
      <Rect x={76} y={48} width={50} height={8} rx={4} fill="#DCE3F5" />
      <Rect x={76} y={62} width={36} height={8} rx={4} fill="#DCE3F5" />
      <Path d="M30 78 C30 70 36 64 44 64 L110 64 C118 64 124 70 124 78 L124 102 C124 110 118 116 110 116 L56 116 L42 128 L44 116 C36 116 30 110 30 102 Z" fill="url(#bubble)" />
      {[50, 66, 82, 98].map((x) => <Circle key={x} cx={x + 4} cy={90} r={5} fill="#FFFFFF" />)}
      <Path d="M138 118 L160 110 L182 118 L182 136 C182 152 172 162 160 168 C148 162 138 152 138 136 Z" fill="url(#shield)" />
      <Path d="M150 138 L157 145 L170 131" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Sparkle x={168} y={40} s={0.8} color={P.yellow} />
    </Svg>
  );
}

export function CalendarCheckArt({ size = 200 }: { readonly size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" {...decorative}>
      <Defs>
        <Lin id="band" from="#4D84FF" to="#2350D8" />
        <Ball id="check" light={P.greenLight} dark={P.greenDark} />
        <Lin id="ring" from="#E6EBF7" to="#A9B5D3" x2="1" y2="0" />
      </Defs>
      <GroundShadow cx={104} cy={186} rx={70} />
      <Rect x={36} y={52} width={128} height={124} rx={22} fill="#D6DDF0" />
      <Rect x={36} y={44} width={128} height={124} rx={22} fill="#FFFFFF" />
      <Path d="M36 66 C36 54 46 44 58 44 L142 44 C154 44 164 54 164 66 L164 78 L36 78 Z" fill="url(#band)" />
      <Rect x={64} y={30} width={12} height={28} rx={6} fill="url(#ring)" />
      <Rect x={124} y={30} width={12} height={28} rx={6} fill="url(#ring)" />
      {[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => (
        <Rect key={`${r}-${c}`} x={54 + c * 24} y={92 + r * 22} width={16} height={12} rx={4} fill={r === 1 && c === 1 ? '#CFDDFF' : '#EEF1F8'} />
      )))}
      <Circle cx={148} cy={150} r={32} fill="#FFFFFF" />
      <Circle cx={148} cy={150} r={27} fill="url(#check)" />
      <Path d="M135 150 L144 159 L162 140" stroke="#FFFFFF" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Rect x={22} y={36} width={8} height={14} rx={2} fill={P.orangeLight} transform="rotate(-25 26 43)" />
      <Rect x={176} y={70} width={7} height={12} rx={2} fill={P.yellow} transform="rotate(30 179 76)" />
      <Circle cx={30} cy={120} r={4} fill="#7FB0FF" />
      <Sparkle x={178} y={28} s={0.9} color={P.yellow} />
    </Svg>
  );
}

export function SearchArt({ size = 220 }: { readonly size?: number }) {
  return (
    <Svg width={size} height={size * 0.82} viewBox="0 0 220 180" {...decorative}>
      <Defs>
        <Lin id="map" from="#E7F7EF" to="#D5EEFF" x2="1" y2="1" />
        <Lin id="handle" from={P.orangeLight} to={P.orangeDark} />
        <Ball id="lens" light="#FFFFFF" dark="#CFE1FF" />
        <Lin id="pin" from="#5A8CFF" to="#2350D8" />
      </Defs>
      <GroundShadow cx={110} cy={168} rx={86} ry={8} />
      <Rect x={20} y={34} width={180} height={124} rx={22} fill="url(#map)" />
      <Path d="M20 96 C60 84 80 112 120 98 C150 88 170 70 200 76" stroke="#FFFFFF" strokeWidth={10} fill="none" />
      <Path d="M86 34 C80 70 96 110 82 158" stroke="#FFFFFF" strokeWidth={8} fill="none" />
      <Rect x={36} y={50} width={30} height={22} rx={6} fill="#C9EBD9" />
      <Rect x={136} y={112} width={40} height={26} rx={6} fill="#CFE0FB" />
      <Rect x={150} y={44} width={30} height={20} rx={6} fill="#FDE6CF" />
      <Path d="M52 118 C52 109 59 103 66 103 C73 103 80 109 80 118 C80 128 66 140 66 140 C66 140 52 128 52 118 Z" fill={P.orangeDark} />
      <Circle cx={66} cy={117} r={5} fill="#FFFFFF" />
      <Path d="M158 82 C158 75 163 70 169 70 C175 70 180 75 180 82 C180 90 169 99 169 99 C169 99 158 90 158 82 Z" fill="url(#pin)" />
      <Circle cx={169} cy={81} r={4} fill="#FFFFFF" />
      <Rect x={128} y={112} width={16} height={46} rx={8} fill="url(#handle)" transform="rotate(-40 136 135)" />
      <Circle cx={110} cy={92} r={34} fill="url(#lens)" opacity={0.92} />
      <Circle cx={110} cy={92} r={34} fill="none" stroke={P.navy} strokeWidth={10} />
      <Path d="M94 80 C98 72 106 68 114 68" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function ScooterArt({ size = 230 }: { readonly size?: number }) {
  return (
    <Svg width={size} height={size * 0.72} viewBox="0 0 240 172" {...decorative}>
      <Defs>
        <Lin id="body" from={P.orangeLight} to={P.orangeDark} />
        <Lin id="shield" from="#4D84FF" to="#1F4ED0" />
        <Ball id="hub" light={P.steelLight} dark={P.steelDark} />
        <Lin id="box" from="#2A3F86" to="#13235B" />
      </Defs>
      <GroundShadow cx={124} cy={160} rx={96} ry={8} />
      {[0, 1, 2].map((k) => <Path key={k} d={`M${6 + k * 6} ${92 + k * 16} H${30 + k * 4}`} stroke="#C9D3EA" strokeWidth={5} strokeLinecap="round" />)}
      <Rect x={34} y={56} width={46} height={32} rx={8} fill="url(#box)" />
      <Rect x={34} y={68} width={46} height={5} fill={P.yellow} />
      <Path d="M52 64 L57 60 L62 64 V68 H52 Z" fill="#FFFFFF" />
      <Circle cx={62} cy={132} r={26} fill="#1F2433" />
      <Circle cx={62} cy={132} r={12} fill="url(#hub)" />
      <Circle cx={190} cy={132} r={26} fill="#1F2433" />
      <Circle cx={190} cy={132} r={12} fill="url(#hub)" />
      <Path d="M40 116 C40 94 58 86 84 86 L142 86 C152 86 158 94 160 104 L166 126 L84 126 C72 126 60 126 52 130 Z" fill="url(#body)" />
      <Path d="M58 98 C70 92 90 92 104 94" stroke="#FFFFFF" strokeOpacity={0.4} strokeWidth={4} strokeLinecap="round" fill="none" />
      <Rect x={88} y={116} width={72} height={10} rx={5} fill="#2B3150" />
      <Path d="M62 84 C62 76 72 72 96 72 C114 72 120 76 120 84 Z" fill="#2B3150" />
      <Path d="M156 66 L174 60 L198 130 L184 136 Z" fill="url(#shield)" />
      <Path d="M158 56 L186 46" stroke="#2B3150" strokeWidth={7} strokeLinecap="round" />
      <Circle cx={182} cy={72} r={8} fill="#FFE27A" stroke="#FFFFFF" strokeWidth={2} />
      <Path d="M196 66 L222 58 M196 76 L224 76" stroke="#FFE27A" strokeWidth={4} strokeLinecap="round" opacity={0.7} />
    </Svg>
  );
}

export function SuccessArt({ size = 180 }: { readonly size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" {...decorative}>
      <Defs>
        <Ball id="ok" light={P.greenLight} dark={P.greenDark} />
      </Defs>
      <GroundShadow cx={100} cy={184} rx={48} />
      <Circle cx={100} cy={96} r={74} fill="#E5F6EC" />
      <Circle cx={100} cy={96} r={56} fill="url(#ok)" />
      <Ellipse cx={82} cy={70} rx={20} ry={10} fill="#FFFFFF" opacity={0.3} transform="rotate(-30 82 70)" />
      <Path d="M74 98 L92 116 L128 80" stroke="#FFFFFF" strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Sparkle x={24} y={40} s={1} color={P.yellow} />
      <Sparkle x={176} y={150} s={0.8} color="#7FB0FF" />
      <Rect x={168} y={34} width={8} height={14} rx={2} fill={P.orangeLight} transform="rotate(25 172 41)" />
      <Circle cx={26} cy={146} r={5} fill="#B7A3FF" />
    </Svg>
  );
}

export function EmptyBoxArt({ size = 160 }: { readonly size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" {...decorative}>
      <Defs>
        <Lin id="front" from="#F6D3A4" to="#E2AC6B" />
        <Lin id="side" from="#E4B57B" to="#C98F4F" />
        <Lin id="flap" from="#FBE2C0" to="#EDC08A" />
      </Defs>
      <GroundShadow cx={100} cy={176} rx={64} />
      <Path d="M44 92 L100 112 L100 172 L44 152 Z" fill="url(#front)" />
      <Path d="M100 112 L156 92 L156 152 L100 172 Z" fill="url(#side)" />
      <Path d="M44 92 L100 72 L156 92 L100 112 Z" fill="#B97E40" />
      <Path d="M44 92 L22 70 L80 52 L100 72 Z" fill="url(#flap)" />
      <Path d="M156 92 L178 70 L120 52 L100 72 Z" fill="url(#flap)" />
      <Rect x={60} y={126} width={26} height={8} rx={4} fill="#FFFFFF" opacity={0.55} transform="rotate(20 73 130)" />
      <Sparkle x={100} y={36} s={1.1} color={P.yellow} />
      <Sparkle x={150} y={30} s={0.6} color="#7FB0FF" />
    </Svg>
  );
}

export function ClockArt({ size = 170 }: { readonly size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" {...decorative}>
      <Defs>
        <Lin id="rim" from={P.orangeLight} to={P.orangeDark} />
        <Ball id="face" light="#FFFFFF" dark="#E9EEF9" />
      </Defs>
      <GroundShadow cx={100} cy={184} rx={52} />
      <Circle cx={96} cy={102} r={66} fill="url(#rim)" />
      <Circle cx={96} cy={102} r={54} fill="url(#face)" />
      {[0, 90, 180, 270].map((a) => <Rect key={a} x={93} y={54} width={6} height={12} rx={3} fill="#C9D3EA" transform={`rotate(${a} 96 102)`} />)}
      <Path d="M96 102 L96 70" stroke={P.navy} strokeWidth={7} strokeLinecap="round" />
      <Path d="M96 102 L120 114" stroke={P.navy} strokeWidth={7} strokeLinecap="round" />
      <Circle cx={96} cy={102} r={6} fill={P.navy} />
      <Circle cx={160} cy={52} r={24} fill="#2F66F0" />
      <Path d="M152 46 C152 40 156 37 161 37 C166 37 169 40 169 45 C169 51 161 51 161 57" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" fill="none" />
      <Circle cx={161} cy={64} r={3} fill="#FFFFFF" />
    </Svg>
  );
}

export function PinArt({ size = 150 }: { readonly size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" {...decorative}>
      <Defs>
        <Lin id="pin" from={P.orangeLight} to={P.orangeDark} />
        <Lin id="plate" from="#E7F7EF" to="#D5E6FF" x2="1" y2="1" />
      </Defs>
      <Ellipse cx={100} cy={160} rx={78} ry={26} fill="url(#plate)" />
      <Path d="M30 160 C70 150 120 170 170 156" stroke="#FFFFFF" strokeWidth={8} fill="none" />
      <Ellipse cx={100} cy={160} rx={22} ry={7} fill="#1B2A6B" opacity={0.18} />
      <Path d="M100 156 C100 156 54 112 54 80 C54 54 75 34 100 34 C125 34 146 54 146 80 C146 112 100 156 100 156 Z" fill="url(#pin)" />
      <Circle cx={100} cy={80} r={19} fill="#FFFFFF" />
      <Path d="M92 82 L100 74 L108 82 V90 H92 Z" fill={P.navy} />
      <Path d="M68 66 C72 54 82 46 92 44" stroke="#FFFFFF" strokeOpacity={0.45} strokeWidth={5} strokeLinecap="round" fill="none" />
    </Svg>
  );
}
