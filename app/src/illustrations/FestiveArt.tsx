// The festive look for the home screens, one per greeting theme (the server picks the festival: catalog/greeting):
// colours for the card and the header wash, and a small drawing. Drawn in code, so a new festival needs no image files.
// A theme the app does not know gets the plain "sparkle" look.
import Svg, { Circle, Defs, G, Line, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

export interface FestiveLook {
  /** The greeting card, top-left to bottom-right. */
  readonly card: readonly [string, string, ...string[]];
  /** Text on the card. */
  readonly ink: string;
  readonly inkMuted: string;
  /** Sparkles and highlights on the card. */
  readonly accent: string;
  /** The header wash behind the top of the home screen (fades into the canvas). */
  readonly wash: readonly [string, string];
}

const LOOKS: Readonly<Record<string, FestiveLook>> = {
  // Diwali, Christmas, New Year: deep indigo night, marigold light.
  lights: { card: ['#1A1150', '#3B1677', '#7A2B83'], ink: '#FFFFFF', inkMuted: 'rgba(255,255,255,0.82)', accent: '#FFC94D', wash: ['#ECE3FF', '#FFE9D2'] },
  kites: { card: ['#0B8BD9', '#1E63FF'], ink: '#FFFFFF', inkMuted: 'rgba(255,255,255,0.85)', accent: '#FFD84D', wash: ['#DDF3FF', '#FFF2D6'] },
  moon: { card: ['#0B3B2E', '#14614A'], ink: '#FFFFFF', inkMuted: 'rgba(255,255,255,0.82)', accent: '#F5D06B', wash: ['#DFF4EA', '#F6EFD9'] },
  colours: { card: ['#D61F78', '#8A2BE2', '#F08A00'], ink: '#FFFFFF', inkMuted: 'rgba(255,255,255,0.88)', accent: '#FFE066', wash: ['#FFE2F0', '#EDE3FF'] },
  leaves: { card: ['#14632F', '#4E9A12'], ink: '#FFFFFF', inkMuted: 'rgba(255,255,255,0.85)', accent: '#FFD23F', wash: ['#E6F7DA', '#FFF3D4'] },
  flag: { card: ['#0A2A8C', '#0A3CF5'], ink: '#FFFFFF', inkMuted: 'rgba(255,255,255,0.85)', accent: '#FF9933', wash: ['#FFEBD9', '#E2F5E4'] },
  flowers: { card: ['#B0175A', '#6D2BD9'], ink: '#FFFFFF', inkMuted: 'rgba(255,255,255,0.86)', accent: '#FFD23F', wash: ['#FFE3EE', '#F0E6FF'] },
  sparkle: { card: ['#1E86FF', '#0A3CF5', '#0628C9'], ink: '#FFFFFF', inkMuted: 'rgba(255,255,255,0.85)', accent: '#B4F06C', wash: ['#E3E6FF', '#F6E6FA'] },
};

export function festiveLook(theme: string): FestiveLook {
  return LOOKS[theme] ?? LOOKS.sparkle!;
}

/** A small four-point sparkle. */
function Sparkle({ x, y, r, color }: { readonly x: number; readonly y: number; readonly r: number; readonly color: string }) {
  return <Path d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`} fill={color} />;
}

/** A clay lamp with its flame. */
function Diya({ x, y, s }: { readonly x: number; readonly y: number; readonly s: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Circle cx={0} cy={-14} r={12} fill="url(#glow)" />
      <Path d="M0 -24 C5 -17 5 -11 0 -8 C-5 -11 -5 -17 0 -24Z" fill="#FFC94D" />
      <Path d="M0 -20 C2 -16 2 -12 0 -10 C-2 -12 -2 -16 0 -20Z" fill="#FFF3C4" />
      <Path d="M-16 -6 Q0 -2 16 -6 Q14 8 0 9 Q-14 8 -16 -6Z" fill="#E8742A" />
      <Path d="M-16 -6 Q0 -2 16 -6 Q0 -9 -16 -6Z" fill="#B4501A" />
      <Path d="M-10 2 Q0 5 10 2" stroke="#FFC94D" strokeWidth={1.5} fill="none" />
    </G>
  );
}

function Lights({ accent }: { readonly accent: string }) {
  // Bulbs hanging from the wire (points on the curve below).
  const bulbs: [number, number, string][] = [[10, 13, accent], [30, 18, '#FF6B9A'], [50, 15, '#7EE0FF'], [70, 9, accent], [90, 7, '#B4F06C'], [110, 11, '#FF6B9A']];
  return (
    <>
      <Path d="M0 6 Q30 26 60 12 Q90 0 120 14" stroke="rgba(255,255,255,0.45)" strokeWidth={1.2} fill="none" />
      {bulbs.map(([x, y, c]) => <G key={x}><Circle cx={x} cy={y + 5} r={5} fill={c} opacity={0.3} /><Circle cx={x} cy={y + 5} r={2.8} fill={c} /></G>)}
      <Diya x={40} y={84} s={1.1} />
      <Diya x={78} y={90} s={0.85} />
      <Sparkle x={100} y={52} r={6} color={accent} />
      <Sparkle x={16} y={58} r={4} color="#FFFFFF" />
    </>
  );
}

function Kites({ accent }: { readonly accent: string }) {
  return (
    <>
      <G transform="translate(70 40) rotate(-12)">
        <Polygon points="0,-26 20,0 0,26 -20,0" fill={accent} />
        <Polygon points="0,-26 20,0 0,0" fill="#FF6B9A" />
        <Line x1={0} y1={-26} x2={0} y2={26} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
        <Path d="M0 26 Q-8 40 4 50 Q14 60 2 70" stroke="#FFFFFF" strokeWidth={1.2} fill="none" />
      </G>
      <G transform="translate(28 30) rotate(14) scale(0.6)">
        <Polygon points="0,-26 20,0 0,26 -20,0" fill="#7EE0FF" />
        <Polygon points="0,0 -20,0 0,26" fill="#B4F06C" />
      </G>
      <Path d="M0 100 Q40 70 120 96" stroke="rgba(255,255,255,0.35)" strokeWidth={1} fill="none" />
      <Sparkle x={104} y={16} r={5} color="#FFFFFF" />
    </>
  );
}

function Moon({ accent }: { readonly accent: string }) {
  return (
    <>
      <Circle cx={66} cy={44} r={30} fill={accent} />
      <Circle cx={80} cy={34} r={27} fill="url(#night)" />
      <Sparkle x={100} y={70} r={7} color={accent} />
      <Sparkle x={28} y={24} r={5} color="#FFFFFF" />
      <Sparkle x={36} y={84} r={4} color={accent} />
      <Line x1={104} y1={0} x2={104} y2={42} stroke={accent} strokeWidth={1} />
      <Path d="M96 42 L112 42 L110 58 Q104 62 98 58Z" fill={accent} opacity={0.9} />
    </>
  );
}

function Colours({ accent }: { readonly accent: string }) {
  const blobs: [number, number, number, string][] = [[38, 40, 20, accent], [76, 30, 16, '#7EE0FF'], [86, 70, 22, '#B4F06C'], [44, 82, 14, '#FFFFFF'], [104, 44, 9, '#FF6B9A']];
  return <>{blobs.map(([x, y, r, c]) => <G key={`${x}${y}`}><Circle cx={x} cy={y} r={r} fill={c} opacity={0.85} /><Circle cx={x + r * 0.8} cy={y - r * 0.6} r={r * 0.25} fill={c} /></G>)}</>;
}

function Leaves({ accent }: { readonly accent: string }) {
  const xs = [14, 34, 54, 74, 94, 114];
  return (
    <>
      <Line x1={0} y1={8} x2={120} y2={8} stroke={accent} strokeWidth={2} />
      {xs.map((x, i) => <Path key={x} d={`M${x} 8 Q${x + 9} 24 ${x} ${i % 2 ? 44 : 38} Q${x - 9} 24 ${x} 8Z`} fill={i % 2 ? '#7BC043' : '#B4F06C'} />)}
      {xs.slice(0, 5).map((x) => <Circle key={x} cx={x + 10} cy={12} r={3} fill="#FF8C1A" />)}
      <Sparkle x={60} y={78} r={8} color={accent} />
    </>
  );
}

function Flag() {
  return (
    <>
      <Line x1={36} y1={10} x2={36} y2={100} stroke="#FFFFFF" strokeWidth={2} />
      <Path d="M37 12 Q62 4 92 14 L92 30 Q62 20 37 28Z" fill="#FF9933" />
      <Path d="M37 28 Q62 20 92 30 L92 46 Q62 36 37 44Z" fill="#FFFFFF" />
      <Path d="M37 44 Q62 36 92 46 L92 62 Q62 52 37 60Z" fill="#138808" />
      <Circle cx={64} cy={37} r={5} stroke="#0A2A8C" strokeWidth={1.4} fill="none" />
      <Sparkle x={104} y={80} r={6} color="#FFFFFF" />
    </>
  );
}

function Flowers({ accent }: { readonly accent: string }) {
  // Bathukamma: tiers of flowers in a cone.
  const tiers: [number, number, string][] = [[80, 34, '#FF6B9A'], [66, 28, accent], [52, 22, '#B4F06C'], [38, 16, '#FF9F43'], [26, 10, '#FFFFFF']];
  return (
    <>
      {tiers.map(([y, w, c]) => <Rect key={y} x={60 - w} y={y} width={w * 2} height={14} rx={7} fill={c} />)}
      <Circle cx={60} cy={20} r={6} fill={accent} />
      <Sparkle x={102} y={30} r={6} color={accent} />
      <Sparkle x={18} y={64} r={4} color="#FFFFFF" />
    </>
  );
}

function Plain({ accent }: { readonly accent: string }) {
  return (
    <>
      <Sparkle x={60} y={50} r={20} color={accent} />
      <Sparkle x={96} y={22} r={8} color="#FFFFFF" />
      <Sparkle x={26} y={78} r={6} color="#FFFFFF" />
    </>
  );
}

/** The drawing for a theme, about 120 × 110. */
export function FestiveArt({ theme, size = 120 }: { readonly theme: string; readonly size?: number }) {
  const look = festiveLook(theme);
  const accent = look.accent;
  return (
    <Svg width={size} height={(size * 110) / 120} viewBox="0 0 120 110" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFD86B" stopOpacity={0.9} />
          <Stop offset="1" stopColor="#FFD86B" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="night" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={look.card[1]} />
          <Stop offset="1" stopColor={look.card[0]} />
        </RadialGradient>
      </Defs>
      {theme === 'lights' ? <Lights accent={accent} />
        : theme === 'kites' ? <Kites accent={accent} />
          : theme === 'moon' ? <Moon accent={accent} />
            : theme === 'colours' ? <Colours accent={accent} />
              : theme === 'leaves' ? <Leaves accent={accent} />
                : theme === 'flag' ? <Flag />
                  : theme === 'flowers' ? <Flowers accent={accent} />
                    : <Plain accent={accent} />}
    </Svg>
  );
}
