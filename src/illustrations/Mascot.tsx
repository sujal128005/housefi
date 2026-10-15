// The Housefi technician mascot: a friendly, rounded "3D toy" character in a blue cap and uniform. Poses cover the
// moments in the journey (welcome wave, wrench at work, thumbs-up on success, toolbox on the way).
import Svg, { Circle, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';
import { Ball, decorative, GroundShadow, Lin, PALETTE as P } from './parts';

export type MascotPose = 'wave' | 'wrench' | 'thumbs' | 'toolbox';

export function Mascot({ size = 200, pose = 'wave' }: { readonly size?: number; readonly pose?: MascotPose }) {
  return (
    <Svg width={size} height={size * 1.1} viewBox="0 0 200 220" {...decorative}>
      <Defs>
        <Ball id="skin" light={P.skinLight} dark={P.skinDark} />
        <Lin id="uniform" from={P.uniformLight} to={P.uniformDark} />
        <Lin id="cap" from={P.capLight} to={P.capDark} />
        <Lin id="steel" from={P.steelLight} to={P.steelDark} x2="1" y2="0" />
        <Lin id="box" from={P.orangeLight} to={P.orangeDark} />
      </Defs>
      <GroundShadow cx={100} cy={212} rx={62} />

      {/* body */}
      <Path d="M38 214 C38 170 62 146 100 146 C138 146 162 170 162 214 Z" fill="url(#uniform)" />
      <Path d="M84 148 L100 170 L116 148 Z" fill={P.yellow} />
      <Path d="M80 146 L97 171 L87 178 L70 152 Z" fill="#2A5FE6" />
      <Path d="M120 146 L103 171 L113 178 L130 152 Z" fill="#2A5FE6" />
      <Path d="M100 172 L100 214" stroke="#1B45BD" strokeWidth={2} />
      <Circle cx={128} cy={190} r={9} fill={P.orangeDark} />
      <Path d="M123 191 L128 186 L133 191 V195 H123 Z" fill={P.white} />
      <Path d="M62 188 H84" stroke="#1B45BD" strokeWidth={3} strokeLinecap="round" />

      {/* neck and head */}
      <Rect x={88} y={126} width={24} height={24} rx={9} fill={P.skinDark} />
      <Circle cx={60} cy={102} r={9} fill={P.skinDark} />
      <Circle cx={140} cy={102} r={9} fill={P.skinDark} />
      <Circle cx={100} cy={98} r={40} fill="url(#skin)" />
      <Path d="M62 86 C62 72 70 64 80 62 L78 94 C70 94 64 92 62 86 Z" fill={P.hair} />
      <Path d="M138 86 C138 72 130 64 120 62 L122 94 C130 94 136 92 138 86 Z" fill={P.hair} />

      {/* cap */}
      <Path d="M58 86 C58 56 78 40 100 40 C122 40 142 56 142 86 C128 80 116 78 100 78 C84 78 72 80 58 86 Z" fill="url(#cap)" />
      <Path d="M68 87 C84 81 116 81 132 87 C139 90 137 99 128 98 C113 94 87 94 72 98 C63 99 61 90 68 87 Z" fill={P.brim} />
      <Circle cx={100} cy={42} r={4} fill={P.brim} />
      <Circle cx={100} cy={63} r={9} fill={P.yellow} />
      <Path d="M95 64 L100 59 L105 64 V68 H95 Z" fill={P.navy} />
      <Path d="M74 60 C80 52 88 48 96 47" stroke="#FFFFFF" strokeOpacity={0.4} strokeWidth={4} strokeLinecap="round" fill="none" />

      {/* face */}
      <Path d="M79 103 C83 99 89 99 93 102" stroke={P.hair} strokeWidth={3.5} strokeLinecap="round" fill="none" />
      <Path d="M107 102 C111 99 117 99 121 103" stroke={P.hair} strokeWidth={3.5} strokeLinecap="round" fill="none" />
      <Ellipse cx={86} cy={111} rx={5} ry={6} fill="#2B1B12" />
      <Ellipse cx={114} cy={111} rx={5} ry={6} fill="#2B1B12" />
      <Circle cx={88} cy={109} r={1.8} fill="#FFFFFF" />
      <Circle cx={116} cy={109} r={1.8} fill="#FFFFFF" />
      <Circle cx={76} cy={123} r={6} fill="#FF7E6B" opacity={0.3} />
      <Circle cx={124} cy={123} r={6} fill="#FF7E6B" opacity={0.3} />
      <Path d="M100 113 C97 119 98 122 102 122" stroke="#C47A52" strokeWidth={2.5} strokeLinecap="round" fill="none" />
      <Path d="M86 127 C92 123 98 124 100 126 C102 124 108 123 114 127 C110 130 104 130 100 128 C96 130 90 130 86 127 Z" fill={P.hair} />
      <Path d="M90 131 Q100 141 110 131 Z" fill="#7A2E22" />
      <Path d="M92 132 Q100 135.5 108 132 Z" fill="#FFFFFF" />

      {pose === 'wrench' ? <WrenchArm /> : null}
      {pose === 'wave' ? <WaveArm /> : null}
      {pose === 'thumbs' ? <ThumbsArm /> : null}
      {pose === 'toolbox' ? <ToolboxArm /> : null}
    </Svg>
  );
}

function WrenchArm() {
  return (
    <G>
      <Path d="M148 172 C160 154 166 138 163 122" stroke="url(#uniform)" strokeWidth={18} strokeLinecap="round" fill="none" />
      <G rotation={18} origin="163, 112">
        <Rect x={158} y={66} width={10} height={50} rx={5} fill="url(#steel)" />
        <Path d="M150 62 C150 50 157 44 160 44 L160 57 L166 57 L166 44 C169 44 176 50 176 62 C176 71 170 76 163 76 C156 76 150 71 150 62 Z" fill="url(#steel)" />
      </G>
      <Circle cx={163} cy={113} r={11} fill={P.skinDark} />
    </G>
  );
}

function WaveArm() {
  return (
    <G>
      <Path d="M148 172 C160 154 168 140 166 124" stroke="url(#uniform)" strokeWidth={18} strokeLinecap="round" fill="none" />
      <G rotation={-12} origin="168, 108">
        <Rect x={156} y={94} width={24} height={26} rx={11} fill={P.skinDark} />
        <Rect x={157} y={80} width={6} height={20} rx={3} fill={P.skinDark} />
        <Rect x={164} y={77} width={6} height={22} rx={3} fill={P.skinDark} />
        <Rect x={171} y={80} width={6} height={20} rx={3} fill={P.skinDark} />
        <Rect x={178} y={98} width={6} height={14} rx={3} fill={P.skinDark} rotation={40} origin="181, 105" />
      </G>
    </G>
  );
}

function ThumbsArm() {
  return (
    <G>
      <Path d="M150 178 C142 190 128 194 118 190" stroke="url(#uniform)" strokeWidth={17} strokeLinecap="round" fill="none" />
      <Rect x={104} y={180} width={22} height={20} rx={8} fill={P.skinDark} />
      <Rect x={106} y={160} width={9} height={24} rx={4.5} fill={P.skinDark} />
    </G>
  );
}

function ToolboxArm() {
  return (
    <G>
      <Path d="M58 166 C50 172 46 176 44 180" stroke="url(#uniform)" strokeWidth={16} strokeLinecap="round" fill="none" />
      <Path d="M32 188 V180 H58 V188" stroke="#8A2E17" strokeWidth={5} fill="none" strokeLinejoin="round" />
      <Rect x={18} y={186} width={56} height={30} rx={7} fill="url(#box)" />
      <Rect x={18} y={196} width={56} height={4} fill="#C94A1A" />
      <Rect x={41} y={193} width={10} height={9} rx={2} fill={P.yellow} />
      <Circle cx={44} cy={181} r={8} fill={P.skinDark} />
    </G>
  );
}
