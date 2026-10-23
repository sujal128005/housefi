// The skill exam's diagrams: one scene per trade and level, with four parts marked A-D (the questions ask which letter
// is which part; the letters must match backend/src/modules/skills/questions/*.json). Drawn flat in a 320 × 220 box.
// Also the "virtual joining" pictures: two pipe ends with a gap where the chosen fitting appears.
import type { ReactNode } from 'react';
import { Circle, Ellipse, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

const INK = '#1B2350';
const PIPE = '#AEB6C8';
const PIPE_DARK = '#7C869E';
const WHITE = '#FFFFFF';
const PALE = '#F6F8FC';
const WALL = '#E9EDF6';
const WATER = '#BFE3FA';
const WOOD = '#E2B57A';
const WOOD_DARK = '#B9864A';
const BRASS = '#E2B34A';
const RED = '#DE3A40';
const BLUE = '#1E63FF';
const GREEN = '#119A57';
const YELLOW = '#FFB21C';
const BLACK = '#2A2F45';
const SOIL = '#E7D5BC';
const LABEL = '#0A3CF5';

export interface Marker {
  readonly letter: 'A' | 'B' | 'C' | 'D';
  /** The part (where the leader line ends). */
  readonly at: readonly [number, number];
  /** Where the letter bubble sits. */
  readonly bubble: readonly [number, number];
}

export interface Scene {
  readonly draw: ReactNode;
  readonly markers: readonly Marker[];
}

const m = (letter: Marker['letter'], at: [number, number], bubble: [number, number]): Marker => ({ letter, at, bubble });
const pipeLine = (x1: number, y1: number, x2: number, y2: number, w = 10, color = PIPE) => (
  <G>
    <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth={w + 3} strokeLinecap="round" />
    <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={w} strokeLinecap="round" />
  </G>
);
const pipePath = (d: string, w = 10, color = PIPE) => (
  <G>
    <Path d={d} stroke={INK} strokeWidth={w + 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d={d} stroke={color} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </G>
);
const box = (x: number, y: number, w: number, h: number, fill: string, rx = 6) => <Rect x={x} y={y} width={w} height={h} rx={rx} fill={fill} stroke={INK} strokeWidth={2.5} />;
const text = (x: number, y: number, s: string, size = 10, fill = INK) => <SvgText x={x} y={y} fontSize={size} fontWeight="bold" fill={fill} textAnchor="middle">{s}</SvgText>;
const fins = (x: number, y: number, w: number, h: number, step = 7, color = PIPE_DARK) => (
  <G>{Array.from({ length: Math.floor(w / step) }, (_, i) => <Line key={i} x1={x + i * step + 3} y1={y} x2={x + i * step + 3} y2={y + h} stroke={color} strokeWidth={1.5} />)}</G>
);

/** A labelled part: a dot on the part, a line, and the letter in a bubble. */
export function MarkerView({ marker, highlight }: { readonly marker: Marker; readonly highlight?: boolean }) {
  const [x, y] = marker.at;
  const [bx, by] = marker.bubble;
  return (
    <G>
      <Line x1={x} y1={y} x2={bx} y2={by} stroke={LABEL} strokeWidth={2} />
      <Circle cx={x} cy={y} r={4} fill={LABEL} stroke={WHITE} strokeWidth={1.5} />
      <Circle cx={bx} cy={by} r={13} fill={highlight ? YELLOW : LABEL} stroke={WHITE} strokeWidth={2.5} />
      <SvgText x={bx} y={by + 5} fontSize={14} fontWeight="bold" fill={highlight ? INK : WHITE} textAnchor="middle">{marker.letter}</SvgText>
    </G>
  );
}

export const SCENES: Readonly<Record<string, Scene>> = {
  // ---------- plumbing ----------
  'scene.pl.sink': {
    draw: (
      <G>
        <Rect x={0} y={60} width={22} height={160} fill={WALL} />
        <Rect x={296} y={60} width={24} height={160} fill={WALL} />
        {pipeLine(10, 168, 74, 168, 9)}
        <Path d="M80 158 C 82 120, 140 112, 154 92" stroke={INK} strokeWidth={5} fill="none" />
        <Path d="M80 158 C 82 120, 140 112, 154 92" stroke={PIPE} strokeWidth={3} fill="none" />
        {box(66, 156, 26, 24, BRASS, 5)}
        <Rect x={74} y={146} width={10} height={10} fill={RED} stroke={INK} strokeWidth={2} />
        <Rect x={40} y={70} width={240} height={14} rx={3} fill={WOOD} stroke={INK} strokeWidth={2.5} />
        <Path d="M92 84 h136 l-12 34 h-112 z" fill={PALE} stroke={INK} strokeWidth={2.5} />
        {box(148, 34, 14, 36, PIPE, 4)}
        <Path d="M155 40 h32 v14" stroke={INK} strokeWidth={9} fill="none" strokeLinejoin="round" />
        <Path d="M155 40 h32 v14" stroke={PIPE} strokeWidth={6} fill="none" strokeLinejoin="round" />
        <Rect x={146} y={28} width={18} height={8} rx={3} fill={BLUE} stroke={INK} strokeWidth={2} />
        {pipePath('M160 118 v26 a18 18 0 0 0 36 0 v-6 h96', 11)}
      </G>
    ),
    markers: [m('A', [186, 54], [222, 30]), m('B', [79, 168], [40, 204]), m('C', [178, 162], [140, 204]), m('D', [250, 138], [272, 196])],
  },
  'scene.pl.cistern': {
    draw: (
      <G>
        {box(70, 28, 180, 152, PALE, 10)}
        <Rect x={72} y={86} width={176} height={92} rx={8} fill={WATER} />
        {pipePath('M18 170 h82 v-96', 9)}
        {box(90, 54, 22, 26, BLUE, 4)}
        <Line x1={112} y1={66} x2={150} y2={86} stroke={INK} strokeWidth={3} />
        <Circle cx={158} cy={90} r={10} fill={YELLOW} stroke={INK} strokeWidth={2} />
        <Rect x={198} y={56} width={12} height={110} fill={WHITE} stroke={INK} strokeWidth={2.5} />
        <Path d="M160 168 h60 v10 h-60 z" fill={PIPE_DARK} stroke={INK} strokeWidth={2} />
        <Ellipse cx={180} cy={164} rx={18} ry={6} fill={RED} stroke={INK} strokeWidth={2} />
        <Rect x={170} y={180} width={24} height={34} fill={PIPE} stroke={INK} strokeWidth={2.5} />
      </G>
    ),
    markers: [m('A', [100, 62], [40, 40]), m('B', [176, 165], [130, 204]), m('C', [204, 70], [282, 60]), m('D', [36, 170], [32, 126])],
  },
  'scene.pl.geyser': {
    draw: (
      <G>
        <Rect x={108} y={18} width={104} height={174} rx={22} fill={WHITE} stroke={INK} strokeWidth={2.5} />
        <Rect x={138} y={40} width={44} height={22} rx={4} fill="#E6F4EA" stroke={INK} strokeWidth={2} />
        {text(160, 56, '60°', 11)}
        {pipeLine(135, 190, 135, 218, 10)}
        <Rect x={129} y={196} width={12} height={8} fill={BLUE} />
        {pipeLine(185, 190, 185, 218, 10)}
        <Rect x={179} y={196} width={12} height={8} fill={RED} />
        {pipeLine(212, 60, 232, 60, 8)}
        {box(230, 50, 18, 20, BRASS, 3)}
        <Line x1={248} y1={54} x2={262} y2={46} stroke={INK} strokeWidth={3} strokeLinecap="round" />
        {pipeLine(108, 170, 90, 170, 7)}
        <Rect x={78} y={162} width={14} height={16} rx={3} fill={BRASS} stroke={INK} strokeWidth={2} />
        <Rect x={81} y={152} width={8} height={10} fill={RED} stroke={INK} strokeWidth={1.5} />
      </G>
    ),
    markers: [m('A', [135, 210], [70, 206]), m('B', [240, 58], [286, 32]), m('C', [185, 210], [252, 206]), m('D', [84, 170], [44, 130])],
  },
  'scene.pl.pump': {
    draw: (
      <G>
        <Rect x={0} y={140} width={130} height={80} fill={SOIL} />
        <Rect x={16} y={150} width={92} height={66} rx={4} fill={WATER} stroke={INK} strokeWidth={2} />
        {pipePath('M60 186 V110 H118', 9)}
        <Rect x={50} y={184} width={20} height={20} rx={3} fill={BRASS} stroke={INK} strokeWidth={2} />
        <Path d="M52 204 h16 M55 200 v8 M60 200 v8 M65 200 v8" stroke={INK} strokeWidth={1.5} />
        <Circle cx={138} cy={110} r={22} fill={BLUE} stroke={INK} strokeWidth={2.5} />
        <Rect x={150} y={96} width={40} height={28} rx={6} fill="#5B6BD6" stroke={INK} strokeWidth={2.5} />
        {pipePath('M138 88 V70 H214 V40', 9)}
        <Rect x={168} y={58} width={26} height={24} rx={4} fill={BRASS} stroke={INK} strokeWidth={2} />
        <Path d="M174 70 h12 m-5 -5 5 5 -5 5" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        {box(224, 14, 84, 62, '#D9E6F5', 6)}
        <Rect x={226} y={34} width={80} height={40} rx={4} fill={WATER} />
        {pipePath('M214 40 H226', 9)}
        {pipePath('M286 76 V170 H230', 9)}
        <Rect x={278} y={112} width={16} height={20} rx={3} fill={BRASS} stroke={INK} strokeWidth={2} />
        <Line x1={294} y1={122} x2={306} y2={122} stroke={INK} strokeWidth={3} />
        <Circle cx={310} cy={122} r={6} fill={RED} stroke={INK} strokeWidth={2} />
      </G>
    ),
    markers: [m('A', [60, 194], [24, 120]), m('B', [140, 112], [120, 166]), m('C', [181, 70], [180, 24]), m('D', [286, 122], [256, 194])],
  },
  // ---------- electrical ----------
  'scene.el.board': {
    draw: (
      <G>
        {box(38, 38, 244, 146, WHITE, 12)}
        {[64, 96, 128].map((x) => <G key={x}><Rect x={x} y={64} width={24} height={40} rx={4} fill={PALE} stroke={INK} strokeWidth={2} /><Rect x={x + 5} y={68} width={14} height={16} rx={2} fill="#DCE3F5" stroke={INK} strokeWidth={1.5} /></G>)}
        <Rect x={186} y={62} width={56} height={56} rx={8} fill={PALE} stroke={INK} strokeWidth={2} />
        <Circle cx={214} cy={78} r={5} fill={INK} />
        <Circle cx={203} cy={98} r={4.5} fill={INK} />
        <Circle cx={225} cy={98} r={4.5} fill={INK} />
        <Circle cx={94} cy={148} r={20} fill="#DCE3F5" stroke={INK} strokeWidth={2} />
        <Line x1={94} y1={148} x2={104} y2={134} stroke={RED} strokeWidth={4} strokeLinecap="round" />
        <Circle cx={256} cy={54} r={7} fill="#FF7A0A" stroke={INK} strokeWidth={2} />
        <Circle cx={256} cy={54} r={12} fill="none" stroke="#FFB27A" strokeWidth={2} />
      </G>
    ),
    markers: [m('A', [108, 84], [108, 18]), m('B', [214, 98], [292, 140]), m('C', [94, 158], [32, 204]), m('D', [256, 54], [300, 22])],
  },
  'scene.el.db': {
    draw: (
      <G>
        {box(28, 30, 264, 166, '#F1F3F8', 10)}
        <Rect x={40} y={98} width={240} height={8} fill={PIPE} stroke={INK} strokeWidth={1.5} />
        {box(50, 62, 38, 76, WHITE, 3)}
        <Rect x={62} y={84} width={14} height={22} rx={2} fill={RED} stroke={INK} strokeWidth={1.5} />
        {box(96, 62, 38, 76, WHITE, 3)}
        <Rect x={102} y={84} width={12} height={22} rx={2} fill={BLUE} stroke={INK} strokeWidth={1.5} />
        <Circle cx={124} cy={78} r={6} fill={YELLOW} stroke={INK} strokeWidth={1.5} />
        {text(124, 81, 'T', 8)}
        {[142, 164, 186, 208, 230].map((x) => <G key={x}><Rect x={x} y={62} width={20} height={76} rx={2} fill={WHITE} stroke={INK} strokeWidth={2} /><Rect x={x + 5} y={86} width={10} height={18} rx={2} fill="#3B6FE0" stroke={INK} strokeWidth={1.2} /></G>)}
        <Rect x={64} y={160} width={180} height={12} rx={2} fill={BRASS} stroke={INK} strokeWidth={2} />
        {[80, 110, 140, 170, 200, 228].map((x) => <Circle key={x} cx={x} cy={166} r={3.5} fill={INK} />)}
        {[110, 170, 228].map((x) => <Line key={x} x1={x} y1={160} x2={x} y2={140} stroke={BLUE} strokeWidth={3} />)}
      </G>
    ),
    markers: [m('A', [69, 72], [60, 14]), m('B', [118, 72], [128, 14]), m('C', [196, 72], [214, 14]), m('D', [236, 166], [292, 206])],
  },
  'scene.el.earthing': {
    draw: (
      <G>
        <Rect x={0} y={60} width={320} height={160} fill={SOIL} />
        <Rect x={112} y={60} width={96} height={150} fill="#D8C2A3" />
        {[96, 116, 136, 156, 176, 196].map((y, i) => <Rect key={y} x={114} y={y} width={92} height={14} fill={i % 2 ? '#F5F5F5' : '#3A3A3A'} opacity={0.85} />)}
        <Rect x={155} y={44} width={10} height={168} fill={PIPE} stroke={INK} strokeWidth={2} />
        <Rect x={118} y={44} width={84} height={20} fill="#BFC3CC" stroke={INK} strokeWidth={2} />
        <Rect x={114} y={36} width={92} height={9} rx={2} fill="#8E95A6" stroke={INK} strokeWidth={2} />
        <Path d="M164 54 C 200 54, 220 22, 300 22" stroke={GREEN} strokeWidth={4} fill="none" />
        <Rect x={296} y={0} width={24} height={60} fill={WALL} stroke={INK} strokeWidth={1.5} />
      </G>
    ),
    markers: [m('A', [160, 190], [70, 190]), m('B', [200, 150], [276, 150]), m('C', [236, 24], [240, 78]), m('D', [140, 40], [60, 30])],
  },
  'scene.el.3phase': {
    draw: (
      <G>
        <Rect x={10} y={10} width={300} height={196} rx={10} fill={WALL} />
        {box(28, 28, 72, 96, WHITE, 6)}
        <Rect x={36} y={40} width={56} height={20} rx={3} fill="#E6F4EA" stroke={INK} strokeWidth={2} />
        {text(64, 55, '04521', 11)}
        <Circle cx={64} cy={92} r={10} fill={RED} opacity={0.8} stroke={INK} strokeWidth={1.5} />
        {box(120, 48, 64, 64, WHITE, 4)}
        <Rect x={138} y={70} width={28} height={22} rx={3} fill={RED} stroke={INK} strokeWidth={2} />
        {[128, 140, 152, 164].map((x) => <Circle key={x} cx={x + 6} cy={104} r={3} fill={INK} />)}
        {[[210, RED], [234, YELLOW], [258, BLUE]].map(([x, c]) => <Circle key={x as number} cx={x as number} cy={42} r={9} fill={c as string} stroke={INK} strokeWidth={2} />)}
        {box(204, 92, 92, 66, WHITE, 6)}
        <Circle cx={250} cy={126} r={18} fill="#DCE3F5" stroke={INK} strokeWidth={2} />
        <Line x1={250} y1={126} x2={262} y2={114} stroke={INK} strokeWidth={5} strokeLinecap="round" />
        {text(222, 106, 'I', 9)}
        {text(250, 104, '0', 9)}
        {text(280, 106, 'II', 9)}
        {[64, 152].map((x) => <Line key={x} x1={x} y1={124} x2={x} y2={196} stroke={INK} strokeWidth={2} />)}
      </G>
    ),
    markers: [m('A', [64, 124], [64, 196]), m('B', [152, 112], [152, 196]), m('C', [258, 42], [298, 22]), m('D', [270, 158], [300, 196])],
  },
  // ---------- AC ----------
  'scene.ac.indoor': {
    draw: (
      <G>
        <Rect x={20} y={40} width={280} height={112} rx={20} fill={WHITE} stroke={INK} strokeWidth={2.5} />
        <Rect x={40} y={52} width={240} height={12} rx={3} fill="#E6E9F2" stroke={INK} strokeWidth={1.5} />
        {Array.from({ length: 30 }, (_, i) => <Line key={i} x1={44 + i * 8} y1={52} x2={44 + i * 8} y2={64} stroke={PIPE} strokeWidth={1} />)}
        <Path d="M50 72 h220 l-10 30 h-200 z" fill="#DCEBFA" stroke={INK} strokeWidth={2} />
        {fins(54, 74, 210, 26, 6, '#7FA6D8')}
        <Ellipse cx={160} cy={126} rx={56} ry={14} fill="#E6E9F2" stroke={INK} strokeWidth={2} />
        {Array.from({ length: 10 }, (_, i) => <Line key={i} x1={112 + i * 10} y1={116} x2={108 + i * 10} y2={136} stroke={PIPE_DARK} strokeWidth={2} />)}
        {pipePath('M290 140 V204', 7, '#DCE3F5')}
        <Path d="M290 210 c-3 4 -3 7 0 8 s3 -4 0 -8 z" fill={WATER} stroke={BLUE} strokeWidth={1} />
      </G>
    ),
    markers: [m('A', [88, 58], [60, 18]), m('B', [226, 88], [262, 18]), m('C', [150, 132], [120, 196]), m('D', [290, 182], [248, 200])],
  },
  'scene.ac.outdoor': {
    draw: (
      <G>
        {box(20, 18, 280, 172, '#F1F3F8', 8)}
        <Rect x={32} y={30} width={160} height={150} rx={4} fill="#DCE3F5" stroke={INK} strokeWidth={1.5} />
        {fins(32, 30, 160, 150, 6, '#AAB8D6')}
        <Circle cx={112} cy={105} r={62} fill={WHITE} stroke={INK} strokeWidth={2.5} />
        <Circle cx={112} cy={105} r={44} fill="none" stroke={PIPE} strokeWidth={1.5} />
        {[0, 120, 240].map((a) => <Path key={a} d="M112 105 C 130 80, 150 90, 152 100 C 140 108, 124 110, 112 105 z" fill="#5B6BD6" stroke={INK} strokeWidth={1.5} transform={`rotate(${a} 112 105)`} />)}
        <Circle cx={112} cy={105} r={8} fill={INK} />
        <Rect x={200} y={30} width={2} height={150} fill={INK} />
        <Rect x={214} y={88} width={52} height={86} rx={20} fill={BLACK} stroke={INK} strokeWidth={2.5} />
        <Rect x={224} y={78} width={8} height={14} fill={PIPE} stroke={INK} strokeWidth={1.5} />
        {box(292, 136, 20, 14, BRASS, 3)}
        {box(292, 158, 20, 14, BRASS, 3)}
      </G>
    ),
    markers: [m('A', [240, 120], [240, 52]), m('B', [44, 172], [40, 206]), m('C', [302, 150], [300, 106]), m('D', [140, 130], [176, 206])],
  },
  'scene.ac.cycle': {
    draw: (
      <G>
        {pipePath('M70 136 V42 H110', 6, '#F2A3A6')}
        {pipePath('M210 42 H262 V66', 6, '#F2A3A6')}
        <Path d="M262 66 c12 4 -12 8 0 12 s-12 8 0 12 s-12 8 0 12 s-12 8 0 12 s-12 8 0 12" stroke={INK} strokeWidth={2.5} fill="none" />
        {pipePath('M262 126 V162 H250', 6, '#A9CFF5')}
        {pipePath('M150 162 H94', 6, '#A9CFF5')}
        <Rect x={110} y={28} width={100} height={28} rx={4} fill="#FDE2E3" stroke={INK} strokeWidth={2} />
        <Path d="M116 50 l8 -16 8 16 8 -16 8 16 8 -16 8 16 8 -16 8 16 8 -16 8 16" stroke={RED} strokeWidth={2} fill="none" />
        <Rect x={150} y={150} width={100} height={26} rx={4} fill="#DDEBFC" stroke={INK} strokeWidth={2} />
        <Path d="M156 170 l8 -14 8 14 8 -14 8 14 8 -14 8 14 8 -14 8 14 8 -14 8 14" stroke={BLUE} strokeWidth={2} fill="none" />
        <Circle cx={70} cy={160} r={26} fill={BLACK} stroke={INK} strokeWidth={2.5} />
        {text(70, 165, 'M', 14, WHITE)}
        <Path d="M66 96 l4 -8 4 8" stroke={INK} strokeWidth={2.5} fill="none" />
        <Path d="M120 158 l-8 4 8 4" stroke={INK} strokeWidth={2.5} fill="none" />
      </G>
    ),
    markers: [m('A', [60, 172], [24, 204]), m('B', [160, 32], [160, 10]), m('C', [264, 100], [304, 100]), m('D', [200, 172], [204, 206])],
  },
  'scene.ac.inverter': {
    draw: (
      <G>
        {box(14, 14, 292, 192, '#F1F3F8', 8)}
        <Rect x={186} y={26} width={108} height={64} rx={4} fill="#3DA35A" stroke={INK} strokeWidth={2.5} />
        {[[198, 36], [222, 36], [246, 50], [270, 36], [210, 62], [262, 66]].map(([x, y]) => <Rect key={`${x}-${y}`} x={x} y={y} width={16} height={12} rx={2} fill={BLACK} />)}
        {Array.from({ length: 6 }, (_, i) => <Line key={i} x1={192 + i * 18} y1={84} x2={200 + i * 18} y2={84} stroke={BRASS} strokeWidth={2} />)}
        <Rect x={96} y={104} width={60} height={92} rx={24} fill={BLACK} stroke={INK} strokeWidth={2.5} />
        {text(126, 156, 'DC', 12, WHITE)}
        {pipePath('M120 104 V40 H176', 7)}
        <Circle cx={120} cy={70} r={6} fill={BLACK} stroke={WHITE} strokeWidth={1.5} />
        <Path d="M126 70 C 150 70, 160 90, 186 86" stroke={INK} strokeWidth={1.5} fill="none" />
        {pipePath('M40 196 V140 H96', 7)}
        <Rect x={28} y={128} width={30} height={30} rx={4} fill={BRASS} stroke={INK} strokeWidth={2} />
        <Rect x={32} y={104} width={22} height={24} rx={6} fill="#5B6BD6" stroke={INK} strokeWidth={2} />
      </G>
    ),
    markers: [m('A', [240, 58], [288, 118]), m('B', [120, 70], [64, 40]), m('C', [43, 143], [24, 196]), m('D', [140, 170], [196, 196])],
  },
  // ---------- appliances ----------
  'scene.ap.washer': {
    draw: (
      <G>
        <Rect x={72} y={10} width={176} height={200} rx={14} fill={WHITE} stroke={INK} strokeWidth={2.5} />
        <Rect x={80} y={18} width={50} height={22} rx={3} fill={PALE} stroke={INK} strokeWidth={2} />
        <Rect x={92} y={26} width={26} height={5} rx={2} fill={PIPE} />
        <Rect x={140} y={18} width={98} height={22} rx={3} fill="#E6E9F2" stroke={INK} strokeWidth={2} />
        <Rect x={150} y={23} width={34} height={12} rx={2} fill="#E6F4EA" stroke={INK} strokeWidth={1.5} />
        <Circle cx={222} cy={29} r={8} fill={WHITE} stroke={INK} strokeWidth={2} />
        <Circle cx={160} cy={118} r={58} fill="#E6E9F2" stroke={INK} strokeWidth={2.5} />
        <Circle cx={160} cy={118} r={44} fill="none" stroke={BLACK} strokeWidth={9} />
        <Circle cx={160} cy={118} r={38} fill="#CFE8FA" stroke={INK} strokeWidth={1.5} />
        <Rect x={84} y={180} width={28} height={20} rx={3} fill={PALE} stroke={INK} strokeWidth={2} />
        <Circle cx={98} cy={190} r={5} fill="none" stroke={INK} strokeWidth={1.5} />
      </G>
    ),
    markers: [m('A', [117, 118], [34, 118]), m('B', [86, 29], [36, 30]), m('C', [90, 190], [36, 194]), m('D', [214, 36], [286, 60])],
  },
  'scene.ap.fridge': {
    draw: (
      <G>
        <Rect x={60} y={10} width={150} height={200} rx={8} fill="#E6E9F2" stroke={INK} strokeWidth={2.5} />
        <Path d="M80 30 h110 v14 h-110 v14 h110 v14 h-110 v14 h110 v14 h-110 v14 h110 v14 h-110" stroke={BLACK} strokeWidth={3} fill="none" />
        {fins(84, 26, 104, 104, 9, '#7C869E')}
        <Rect x={138} y={160} width={58} height={44} rx={18} fill={BLACK} stroke={INK} strokeWidth={2.5} />
        <Rect x={70} y={186} width={60} height={16} rx={2} fill={WHITE} stroke={INK} strokeWidth={2} />
        <Rect x={72} y={194} width={56} height={6} fill={WATER} />
        <Circle cx={266} cy={56} r={34} fill={WHITE} stroke={INK} strokeWidth={2.5} />
        <Circle cx={266} cy={56} r={18} fill="#DCE3F5" stroke={INK} strokeWidth={2} />
        <Line x1={266} y1={56} x2={276} y2={44} stroke={RED} strokeWidth={4} strokeLinecap="round" />
        {text(244, 84, '1', 9)}
        {text(288, 84, '7', 9)}
        {text(266, 18, 'inside', 9, '#565D78')}
      </G>
    ),
    markers: [m('A', [190, 182], [292, 190]), m('B', [188, 100], [292, 134]), m('C', [80, 194], [28, 170]), m('D', [266, 66], [232, 120])],
  },
  'scene.ap.microwave': {
    draw: (
      <G>
        {box(14, 28, 292, 168, '#F1F3F8', 10)}
        <Rect x={26} y={40} width={146} height={130} rx={4} fill={WHITE} stroke={INK} strokeWidth={2} />
        <Ellipse cx={99} cy={150} rx={56} ry={11} fill="#CFE8FA" stroke={INK} strokeWidth={2} />
        <Rect x={88} y={172} width={22} height={16} rx={3} fill={PIPE_DARK} stroke={INK} strokeWidth={2} />
        <Line x1={180} y1={40} x2={180} y2={190} stroke={INK} strokeWidth={2} />
        <Rect x={196} y={44} width={54} height={50} rx={4} fill={PIPE} stroke={INK} strokeWidth={2.5} />
        {fins(196, 44, 54, 50, 7, INK)}
        <Rect x={172} y={56} width={24} height={20} fill="#E6E9F2" stroke={INK} strokeWidth={2} />
        <Rect x={262} y={52} width={34} height={36} rx={14} fill="#3B6FE0" stroke={INK} strokeWidth={2.5} />
        <Rect x={196} y={114} width={80} height={62} rx={4} fill="#8E95A6" stroke={INK} strokeWidth={2.5} />
        <Rect x={214} y={124} width={44} height={42} rx={4} fill={BRASS} stroke={INK} strokeWidth={2} />
        {[132, 142, 152].map((y) => <Line key={y} x1={214} y1={y} x2={258} y2={y} stroke={INK} strokeWidth={1.2} />)}
      </G>
    ),
    markers: [m('A', [222, 52], [222, 12]), m('B', [280, 70], [300, 120]), m('C', [236, 168], [290, 206]), m('D', [99, 182], [40, 206])],
  },
  'scene.ap.inverter-washer': {
    draw: (
      <G>
        <Circle cx={150} cy={108} r={78} fill="#E6E9F2" stroke={INK} strokeWidth={2.5} />
        <Circle cx={150} cy={108} r={42} fill="#B7C0D6" stroke={INK} strokeWidth={2.5} />
        {Array.from({ length: 12 }, (_, i) => <Rect key={i} x={146} y={70} width={8} height={14} fill={BRASS} stroke={INK} strokeWidth={1} transform={`rotate(${i * 30} 150 108)`} />)}
        <Circle cx={150} cy={108} r={14} fill={PIPE_DARK} stroke={INK} strokeWidth={2} />
        <Rect x={176} y={78} width={14} height={10} rx={2} fill={BLACK} stroke={WHITE} strokeWidth={1} />
        <Path d="M190 82 C 220 70, 230 70, 244 60" stroke={INK} strokeWidth={1.5} fill="none" />
        <Rect x={238} y={16} width={72} height={52} rx={4} fill="#3DA35A" stroke={INK} strokeWidth={2.5} />
        {[[248, 26], [270, 26], [290, 40], [252, 46]].map(([x, y]) => <Rect key={`${x}-${y}`} x={x} y={y} width={14} height={10} rx={2} fill={BLACK} />)}
        <Circle cx={52} cy={186} r={16} fill={PIPE} stroke={INK} strokeWidth={2.5} />
        {pipePath('M68 186 H96', 7)}
        {pipePath('M52 170 V160', 7)}
      </G>
    ),
    markers: [m('A', [150, 136], [150, 206]), m('B', [183, 83], [250, 120]), m('C', [274, 60], [292, 104]), m('D', [44, 186], [20, 140])],
  },
  // ---------- cleaning ----------
  'scene.cl.bathroom': {
    draw: (
      <G>
        <Rect x={0} y={0} width={320} height={164} fill={WALL} />
        {Array.from({ length: 6 }, (_, r) => Array.from({ length: 5 }, (_, c) => <Rect key={`${r}-${c}`} x={14 + c * 38} y={12 + r * 25} width={36} height={23} fill={WHITE} stroke="#5E6577" strokeWidth={2} />))}
        <Path d="M0 164 h320 l0 56 h-320 z" fill="#D7DCE8" />
        <Ellipse cx={92} cy={190} rx={22} ry={8} fill={PIPE} stroke={INK} strokeWidth={2} />
        {[84, 92, 100].map((x) => <Line key={x} x1={x} y1={184} x2={x} y2={196} stroke={INK} strokeWidth={1.5} />)}
        <Circle cx={262} cy={42} r={24} fill={WHITE} stroke={INK} strokeWidth={2.5} />
        {[0, 60, 120].map((a) => <Line key={a} x1={244} y1={42} x2={280} y2={42} stroke={PIPE_DARK} strokeWidth={2} transform={`rotate(${a} 262 42)`} />)}
        <Path d="M216 104 h72 l-8 28 h-56 z" fill={WHITE} stroke={INK} strokeWidth={2.5} />
        <Rect x={248} y={90} width={8} height={14} fill={PIPE} stroke={INK} strokeWidth={1.5} />
        {pipeLine(252, 132, 252, 164, 6)}
      </G>
    ),
    markers: [m('A', [262, 64], [300, 90]), m('B', [52, 60], [24, 104]), m('C', [236, 118], [190, 150]), m('D', [104, 190], [170, 202])],
  },
  'scene.cl.kitchen': {
    draw: (
      <G>
        <Rect x={0} y={0} width={320} height={126} fill={WALL} />
        {Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => <Rect key={`${r}-${c}`} x={18 + c * 28} y={58 + r * 20} width={26} height={18} fill={WHITE} stroke="#9AA3B8" strokeWidth={1.5} />))}
        {[[34, 70], [70, 92], [52, 104]].map(([x, y]) => <Circle key={`${x}`} cx={x} cy={y} r={3} fill="#E9B44A" />)}
        <Path d="M120 8 h80 l14 44 h-108 z" fill="#C9CFDB" stroke={INK} strokeWidth={2.5} />
        <Rect x={112} y={50} width={96} height={10} rx={2} fill={PIPE_DARK} stroke={INK} strokeWidth={2} />
        {Array.from({ length: 11 }, (_, i) => <Line key={i} x1={118 + i * 8} y1={50} x2={118 + i * 8} y2={60} stroke={WHITE} strokeWidth={1} />)}
        <Rect x={0} y={124} width={320} height={16} fill={WOOD} stroke={INK} strokeWidth={2} />
        <Rect x={0} y={140} width={320} height={80} fill="#E6D4B8" />
        {[132, 192].map((x) => <G key={x}><Ellipse cx={x} cy={120} rx={20} ry={5} fill={BLACK} /><Path d={`M${x - 10} 118 q4 -12 10 0 q6 -12 10 0`} fill="#3D8BFF" /></G>)}
        <Rect x={236} y={124} width={62} height={10} fill="#9AA3B8" stroke={INK} strokeWidth={2} />
        {pipePath('M276 124 V100 H262 V108', 5)}
      </G>
    ),
    markers: [m('A', [130, 56], [70, 24]), m('B', [192, 120], [196, 180]), m('C', [266, 130], [290, 180]), m('D', [56, 80], [24, 156])],
  },
  'scene.cl.tank': {
    draw: (
      <G>
        <Rect x={60} y={42} width={200} height={150} rx={12} fill={PALE} stroke={INK} strokeWidth={2.5} />
        <Rect x={62} y={82} width={196} height={92} fill={WATER} />
        <Rect x={62} y={170} width={196} height={20} rx={8} fill="#9C7A52" />
        {[90, 130, 170, 210, 240].map((x) => <Circle key={x} cx={x} cy={178} r={3} fill="#6E5236" />)}
        <Rect x={126} y={30} width={68} height={14} rx={3} fill="#5E6577" stroke={INK} strokeWidth={2} />
        <Rect x={150} y={24} width={20} height={6} rx={2} fill={INK} />
        {pipePath('M10 68 H70', 9)}
        {pipePath('M250 176 H316', 9)}
        <Rect x={276} y={166} width={18} height={20} rx={3} fill={BRASS} stroke={INK} strokeWidth={2} />
        <Line x1={285} y1={166} x2={285} y2={152} stroke={INK} strokeWidth={3} />
        <Circle cx={285} cy={148} r={6} fill={RED} stroke={INK} strokeWidth={2} />
      </G>
    ),
    markers: [m('A', [36, 68], [30, 24]), m('B', [285, 176], [296, 112]), m('C', [160, 180], [160, 208]), m('D', [180, 36], [240, 14])],
  },
  'scene.cl.labels': {
    draw: (
      <G>
        {[47, 122, 197, 272].map((x) => <Polygon key={x} points={`${x},50 ${x + 34},84 ${x},118 ${x - 34},84`} fill={WHITE} stroke={RED} strokeWidth={5} strokeLinejoin="round" />)}
        {/* corrosive: liquid from two tubes onto a hand and a bar */}
        <Path d="M33 64 l10 10 M51 64 l-6 10" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        <Circle cx={42} cy={82} r={2} fill={INK} />
        <Circle cx={48} cy={82} r={2} fill={INK} />
        <Path d="M30 98 h14 v-4 h4 v4 h4 v8 h-22 z" fill={INK} />
        <Path d="M54 92 h12 v14 h-12 l3 -7 z" fill={INK} />
        {/* flammable: flame */}
        <Path d="M122 100 c-12 0 -14 -12 -8 -20 c2 6 5 6 5 2 c0 -8 6 -12 6 -18 c8 6 12 14 10 24 c2 -2 3 -4 3 -6 c4 8 0 18 -16 18 z" fill={INK} />
        <Rect x={106} y={102} width={32} height={3} fill={INK} />
        {/* toxic: skull and crossbones */}
        <Path d="M181 104 l32 -16 M181 88 l32 16" stroke={INK} strokeWidth={4} strokeLinecap="round" />
        <Circle cx={197} cy={78} r={12} fill={INK} />
        <Rect x={191} y={86} width={12} height={8} fill={INK} />
        <Circle cx={192} cy={77} r={3} fill={WHITE} />
        <Circle cx={202} cy={77} r={3} fill={WHITE} />
        {/* irritant: exclamation mark */}
        <Rect x={267} y={62} width={10} height={30} rx={3} fill={INK} />
        <Circle cx={272} cy={102} r={6} fill={INK} />
      </G>
    ),
    markers: [m('A', [47, 122], [47, 166]), m('B', [122, 122], [122, 166]), m('C', [197, 122], [197, 166]), m('D', [272, 122], [272, 166])],
  },
  // ---------- carpentry ----------
  'scene.cp.door': {
    draw: (
      <G>
        <Rect x={68} y={4} width={164} height={208} fill={WALL} stroke={INK} strokeWidth={2} />
        <Rect x={80} y={12} width={140} height={200} fill={WOOD} stroke={INK} strokeWidth={2.5} />
        <Rect x={96} y={30} width={108} height={70} rx={4} fill="none" stroke={WOOD_DARK} strokeWidth={2} />
        <Rect x={96} y={120} width={108} height={70} rx={4} fill="none" stroke={WOOD_DARK} strokeWidth={2} />
        {[34, 168].map((y) => <Rect key={y} x={76} y={y} width={10} height={26} rx={2} fill={PIPE} stroke={INK} strokeWidth={2} />)}
        <Rect x={200} y={98} width={10} height={24} rx={3} fill={PIPE_DARK} stroke={INK} strokeWidth={2} />
        <Path d="M205 104 h-26" stroke={INK} strokeWidth={6} strokeLinecap="round" />
        <Path d="M205 104 h-26" stroke={PIPE} strokeWidth={3.5} strokeLinecap="round" />
        <Rect x={220} y={110} width={12} height={7} rx={1} fill={BRASS} stroke={INK} strokeWidth={1.5} />
        <Rect x={0} y={212} width={320} height={8} fill="#C9CFDB" />
        <Path d="M262 212 v-10 a8 8 0 0 1 16 0 v10 z" fill={BLACK} stroke={INK} strokeWidth={1.5} />
      </G>
    ),
    markers: [m('A', [81, 47], [30, 40]), m('B', [186, 104], [160, 60]), m('C', [230, 113], [290, 100]), m('D', [270, 202], [300, 160])],
  },
  'scene.cp.cabinet': {
    draw: (
      <G>
        <Rect x={40} y={18} width={240} height={184} rx={4} fill={WOOD} stroke={INK} strokeWidth={2.5} />
        <Rect x={54} y={30} width={212} height={160} fill="#F3DFC0" stroke={INK} strokeWidth={1.5} />
        <Rect x={54} y={96} width={212} height={8} fill={WOOD_DARK} stroke={INK} strokeWidth={1.5} />
        {[46, 62, 78, 112, 128].map((y) => <Circle key={y} cx={258} cy={y} r={2} fill={INK} />)}
        <Rect x={252} y={104} width={10} height={4} fill={PIPE_DARK} />
        <Circle cx={62} cy={60} r={8} fill={PIPE} stroke={INK} strokeWidth={2} />
        <Path d="M62 60 h-26 v14" stroke={PIPE_DARK} strokeWidth={4} fill="none" />
        <Rect x={64} y={140} width={192} height={44} rx={3} fill={WOOD} stroke={INK} strokeWidth={2} />
        <Rect x={140} y={156} width={40} height={6} rx={3} fill={PIPE_DARK} />
        <Rect x={54} y={172} width={212} height={5} fill={PIPE} stroke={INK} strokeWidth={1} />
        {[90, 230].map((x) => <Circle key={x} cx={x} cy={174} r={3.5} fill={WHITE} stroke={INK} strokeWidth={1.5} />)}
        <Rect x={226} y={34} width={30} height={10} rx={3} fill={BRASS} stroke={INK} strokeWidth={1.5} />
        <Rect x={236} y={28} width={4} height={8} fill={PIPE_DARK} />
      </G>
    ),
    markers: [m('A', [62, 60], [20, 30]), m('B', [258, 106], [300, 96]), m('C', [230, 174], [300, 192]), m('D', [244, 39], [300, 30])],
  },
  'scene.cp.joints': {
    draw: (
      <G>
        {[[8, 8], [164, 8], [8, 116], [164, 116]].map(([x, y]) => <Rect key={`${x}-${y}`} x={x} y={y} width={148} height={98} rx={8} fill={PALE} stroke="#D1D5E2" strokeWidth={1.5} />)}
        {/* dovetail */}
        <Path d="M30 30 h28 v62 h-28 z" fill={WOOD} stroke={INK} strokeWidth={2} />
        <Path d="M58 30 h70 v20 h-70 l-6 -4 l0 -4 z" fill="#ECCB97" stroke={INK} strokeWidth={2} />
        <Path d="M58 36 l-10 -3 v14 l10 -3 M58 58 l-10 -3 v14 l10 -3" fill="#ECCB97" stroke={INK} strokeWidth={2} />
        <Path d="M58 56 h70 v20 h-70 z" fill="#ECCB97" stroke={INK} strokeWidth={2} />
        {/* mortise and tenon */}
        <Rect x={186} y={24} width={32} height={72} fill={WOOD} stroke={INK} strokeWidth={2} />
        <Rect x={194} y={44} width={16} height={28} fill="#8B5E2E" stroke={INK} strokeWidth={1.5} strokeDasharray="3 2" />
        <Path d="M232 44 h-16 v28 h16 v6 h44 v-40 h-44 z" fill="#ECCB97" stroke={INK} strokeWidth={2} />
        {/* butt */}
        <Rect x={34} y={136} width={28} height={60} fill={WOOD} stroke={INK} strokeWidth={2} />
        <Rect x={62} y={150} width={68} height={24} fill="#ECCB97" stroke={INK} strokeWidth={2} />
        {[156, 168].map((y) => <Line key={y} x1={44} y1={y} x2={76} y2={y} stroke={PIPE_DARK} strokeWidth={3} />)}
        {/* dowel */}
        <Rect x={184} y={136} width={40} height={60} fill={WOOD} stroke={INK} strokeWidth={2} />
        <Rect x={250} y={136} width={40} height={60} fill="#ECCB97" stroke={INK} strokeWidth={2} />
        {[152, 180].map((y) => <Rect key={y} x={214} y={y - 4} width={46} height={8} rx={4} fill="#C99A5B" stroke={INK} strokeWidth={1.5} />)}
      </G>
    ),
    markers: [m('A', [56, 50], [22, 18]), m('B', [214, 58], [178, 18]), m('C', [62, 162], [22, 126]), m('D', [237, 152], [178, 126])],
  },
  'scene.cp.sliding': {
    draw: (
      <G>
        <Rect x={30} y={30} width={260} height={176} rx={4} fill={WOOD} stroke={INK} strokeWidth={2.5} />
        <Rect x={30} y={30} width={260} height={12} fill={PIPE} stroke={INK} strokeWidth={2} />
        <Rect x={30} y={196} width={260} height={10} fill={PIPE} stroke={INK} strokeWidth={2} />
        <Rect x={44} y={42} width={124} height={154} fill="#DDEBF7" stroke={INK} strokeWidth={2} />
        <Rect x={152} y={46} width={124} height={150} fill="#ECCB97" stroke={INK} strokeWidth={2} />
        <Rect x={160} y={110} width={6} height={30} rx={3} fill={PIPE_DARK} />
        <Rect x={222} y={42} width={20} height={12} rx={2} fill={BLACK} stroke={INK} strokeWidth={1.5} />
        {[86, 194].map((x) => <Circle key={x} cx={x} cy={196} r={8} fill={PIPE_DARK} stroke={INK} strokeWidth={2} />)}
        <Circle cx={262} cy={186} r={5} fill={BRASS} stroke={INK} strokeWidth={1.5} />
        <Line x1={259} y1={186} x2={265} y2={186} stroke={INK} strokeWidth={1.5} />
      </G>
    ),
    markers: [m('A', [90, 36], [90, 14]), m('B', [86, 196], [36, 214]), m('C', [232, 48], [300, 16]), m('D', [262, 186], [306, 160])],
  },
};

/** The joining tasks: two pipe ends and the gap the chosen fitting fills (centre of the gap in `gap`). */
export interface Task {
  readonly draw: ReactNode;
  readonly gap: readonly [number, number];
}

export const TASKS: Readonly<Record<string, Task>> = {
  'task.pl.corner': { draw: <G>{pipePath('M40 150 H130', 22)}{pipePath('M170 110 V30', 22)}</G>, gap: [158, 140] },
  'task.pl.straight': { draw: <G>{pipePath('M20 110 H120', 22)}{pipePath('M200 110 H300', 22)}</G>, gap: [160, 110] },
  'task.pl.branch': { draw: <G>{pipePath('M20 90 H120', 22)}{pipePath('M200 90 H300', 22)}{pipePath('M160 130 V200', 22)}</G>, gap: [160, 96] },
  'task.pl.reduce': { draw: <G>{pipePath('M20 110 H120', 30)}{pipePath('M200 110 H300', 14)}</G>, gap: [160, 110] },
  'task.pl.adapter': {
    draw: (
      <G>
        {pipePath('M20 110 H120', 22, '#F4E7C9')}
        {pipePath('M200 110 H300', 20, BRASS)}
        {[210, 220, 230].map((x) => <Line key={x} x1={x} y1={100} x2={x} y2={120} stroke={INK} strokeWidth={1.5} />)}
        {text(70, 150, 'CPVC', 12)}
        {text(250, 150, 'GI', 12)}
      </G>
    ),
    gap: [160, 110],
  },
};
