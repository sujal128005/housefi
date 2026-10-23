// The tools and parts of the skill exam's "choose the right one" questions. Common tools use the icon font; pipe
// fittings, meters, electrical parts and the rest are small drawings (48 × 48), flat, in the app's ink and tints.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

type Glyph = ComponentProps<typeof MaterialCommunityIcons>['name'];

const INK = '#1B2350';
const METAL = '#AEB6C8';
const STEEL = '#7C869E';
const BRASS = '#E2B34A';
const PVC = '#F2F4F9';
const CPVC = '#F4E7C9';
const WOOD = '#D9A766';
const RED = '#DE3A40';
const BLUE = '#1E63FF';
const GREEN = '#119A57';
const YELLOW = '#FFB21C';
const BLACK = '#2A2F45';

/** Tools drawn with the icon font, and the tint behind each. */
export const TOOL_GLYPHS: Readonly<Record<string, { readonly glyph: Glyph; readonly color: string }>> = {
  'tool.adjustable-spanner': { glyph: 'wrench', color: STEEL },
  'tool.air-blower': { glyph: 'hair-dryer', color: BLUE },
  'tool.bleach': { glyph: 'bottle-tonic-skull', color: '#5B6BD6' },
  'tool.brazing-torch': { glyph: 'torch', color: '#F07A12' },
  'tool.broom': { glyph: 'broom', color: '#B9864A' },
  'tool.brush': { glyph: 'brush-variant', color: '#8A5BD6' },
  'tool.bucket': { glyph: 'pail', color: BLUE },
  'tool.coil-cleaner': { glyph: 'spray', color: '#00A3C4' },
  'tool.crimper': { glyph: 'pliers', color: '#C23B3B' },
  'tool.degreaser': { glyph: 'spray-bottle', color: '#F07A12' },
  'tool.descaler': { glyph: 'bottle-tonic', color: '#00A3C4' },
  'tool.die-set': { glyph: 'cog-outline', color: STEEL },
  'tool.disinfectant': { glyph: 'bottle-tonic-plus-outline', color: GREEN },
  'tool.face-mask': { glyph: 'face-mask', color: '#3D8BD6' },
  'tool.glass-cleaner': { glyph: 'spray-bottle', color: '#3DB5E6' },
  'tool.gloves': { glyph: 'hand-back-right', color: YELLOW },
  'tool.goggles': { glyph: 'safety-goggles', color: '#2F7D6B' },
  'tool.grout-brush': { glyph: 'brush', color: '#8A5BD6' },
  'tool.hammer': { glyph: 'hammer', color: '#8D5A2B' },
  'tool.lighter': { glyph: 'fire', color: RED },
  'tool.manifold-gauge': { glyph: 'gauge', color: '#2F5BD6' },
  'tool.measuring-tape': { glyph: 'tape-measure', color: YELLOW },
  'tool.moisture-meter': { glyph: 'water-percent', color: '#1E8FD6' },
  'tool.mould-remover': { glyph: 'spray', color: '#5A8F2B' },
  'tool.neutral-cleaner': { glyph: 'bottle-soda', color: '#3DA58A' },
  'tool.paint': { glyph: 'format-paint', color: '#D65B9A' },
  'tool.plier': { glyph: 'pliers', color: '#2F5BD6' },
  'tool.pressure-gauge': { glyph: 'gauge-full', color: '#2F5BD6' },
  'tool.sandpaper': { glyph: 'texture-box', color: '#B9864A' },
  'tool.saw': { glyph: 'hand-saw', color: '#8D5A2B' },
  'tool.screwdriver': { glyph: 'screwdriver', color: '#D6452B' },
  'tool.soldering-iron': { glyph: 'soldering-iron', color: '#C25B2B' },
  'tool.square': { glyph: 'ruler-square', color: '#8D5A2B' },
  'tool.squeegee': { glyph: 'squeegee', color: '#3D8BD6' },
  'tool.thermometer': { glyph: 'thermometer', color: RED },
  'tool.vacuum': { glyph: 'vacuum', color: '#5B6BD6' },
  'tool.weighing-scale': { glyph: 'scale', color: '#2F7D6B' },
  'part.bulb': { glyph: 'lightbulb', color: YELLOW },
  'part.door-lock': { glyph: 'lock', color: STEEL },
  'part.heating-element': { glyph: 'heating-coil', color: RED },
  'part.inlet-valve': { glyph: 'valve', color: BLUE },
  'part.nail': { glyph: 'nail', color: STEEL },
  'part.switch': { glyph: 'light-switch', color: '#5B6BD6' },
  'part.thermostat': { glyph: 'thermostat', color: RED },
};

const pipe = (d: string, fill = PVC) => <Path d={d} fill={fill} stroke={INK} strokeWidth={2} strokeLinejoin="round" />;
const cylinder = (body: string, cap: string, label: string) => (
  <G>
    <Rect x={14} y={10} width={20} height={34} rx={8} fill={body} stroke={INK} strokeWidth={2} />
    <Rect x={19} y={4} width={10} height={8} rx={2} fill={cap} stroke={INK} strokeWidth={2} />
    <SvgText x={24} y={32} fontSize={label.length > 2 ? 7 : 9} fontWeight="bold" fill="#FFFFFF" textAnchor="middle">{label}</SvgText>
  </G>
);
const meter = (screen: ReactNode, top?: ReactNode, color = YELLOW) => (
  <G>
    {top}
    <Rect x={12} y={14} width={24} height={30} rx={5} fill={color} stroke={INK} strokeWidth={2} />
    <Rect x={16} y={18} width={16} height={10} rx={2} fill="#E6F4EA" stroke={INK} strokeWidth={1.5} />
    {screen}
  </G>
);

/** Drawn tools and parts (viewBox 0 0 48 48). */
export const DRAWN: Readonly<Record<string, ReactNode>> = {
  // ---------- pipe fittings ----------
  'part.elbow': pipe('M8 30h14a4 4 0 0 0 4-4V10h12v16a16 16 0 0 1-16 16H8z'),
  'part.tee': pipe('M4 18h40v12H30v14H18V30H4z'),
  'part.coupler': <G>{pipe('M6 17h36v14H6z')}<Line x1={24} y1={17} x2={24} y2={31} stroke={INK} strokeWidth={1.5} strokeDasharray="2 2" /></G>,
  'part.end-cap': <G>{pipe('M8 16h22a10 10 0 0 1 10 10v-4 4a10 10 0 0 1-10 10H8z')}<Line x1={14} y1={16} x2={14} y2={36} stroke={INK} strokeWidth={1.5} /></G>,
  'part.reducer': pipe('M4 12h18l10 8h12v8H32l-10 8H4z'),
  'part.union': <G>{pipe('M4 18h12v12H4zM32 18h12v12H32z')}<Path d="M16 13h16v22H16z" fill={BRASS} stroke={INK} strokeWidth={2} /><Path d="M20 13v22M24 13v22M28 13v22" stroke={INK} strokeWidth={1} /></G>,
  'part.adapter': <G>{pipe('M4 16h20v16H4z', CPVC)}<Path d="M24 18h18v12H24z" fill={BRASS} stroke={INK} strokeWidth={2} /><Path d="M28 18v12M32 18v12M36 18v12M40 18v12" stroke={INK} strokeWidth={1} /></G>,
  'part.nrv': <G>{pipe('M2 20h44v8H2z', METAL)}<Rect x={12} y={12} width={24} height={24} rx={4} fill={BRASS} stroke={INK} strokeWidth={2} /><Path d="M17 24h12m-5-5 5 5-5 5" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" /></G>,
  'part.gate-valve': <G>{pipe('M2 30h44v8H2z', METAL)}<Rect x={16} y={22} width={16} height={22} rx={3} fill={BRASS} stroke={INK} strokeWidth={2} /><Line x1={24} y1={22} x2={24} y2={12} stroke={INK} strokeWidth={3} /><Circle cx={24} cy={9} r={6} fill={RED} stroke={INK} strokeWidth={2} /></G>,
  'part.foot-valve': <G>{pipe('M18 2h12v18H18z', METAL)}<Rect x={14} y={20} width={20} height={10} rx={2} fill={BRASS} stroke={INK} strokeWidth={2} /><Rect x={12} y={30} width={24} height={14} rx={3} fill={PVC} stroke={INK} strokeWidth={2} /><Path d="M16 34h16M16 38h16M20 30v14M24 30v14M28 30v14" stroke={INK} strokeWidth={1} /></G>,
  'part.prv': <G>{pipe('M2 30h44v8H2z', METAL)}<Rect x={14} y={24} width={20} height={18} rx={4} fill={BRASS} stroke={INK} strokeWidth={2} /><Rect x={18} y={8} width={12} height={16} rx={3} fill={BRASS} stroke={INK} strokeWidth={2} /><Path d="M21 12h6M21 16h6M21 20h6" stroke={INK} strokeWidth={1.5} /><Line x1={34} y1={10} x2={42} y2={4} stroke={INK} strokeWidth={2} /></G>,
  'part.pipe-insulation': <G><Rect x={4} y={14} width={40} height={20} rx={10} fill={BLACK} stroke={INK} strokeWidth={2} /><Circle cx={8} cy={24} r={6} fill={METAL} stroke={INK} strokeWidth={1.5} /><Path d="M16 16v16M24 16v16M32 16v16" stroke="#555B75" strokeWidth={1} /></G>,
  // ---------- electrical ----------
  'part.capacitor': <G><Rect x={14} y={10} width={20} height={32} rx={6} fill="#3B6FE0" stroke={INK} strokeWidth={2} /><Line x1={20} y1={10} x2={20} y2={4} stroke={INK} strokeWidth={2.5} /><Line x1={28} y1={10} x2={28} y2={4} stroke={INK} strokeWidth={2.5} /><SvgText x={24} y={30} fontSize={8} fontWeight="bold" fill="#FFFFFF" textAnchor="middle">µF</SvgText></G>,
  'part.mcb': <G><Rect x={15} y={6} width={18} height={36} rx={3} fill="#FFFFFF" stroke={INK} strokeWidth={2} /><Rect x={20} y={16} width={8} height={12} rx={2} fill={BLUE} stroke={INK} strokeWidth={1.5} /><SvgText x={24} y={38} fontSize={7} fontWeight="bold" fill={INK} textAnchor="middle">C16</SvgText></G>,
  'part.rccb': <G><Rect x={8} y={6} width={32} height={36} rx={3} fill="#FFFFFF" stroke={INK} strokeWidth={2} /><Rect x={14} y={16} width={8} height={12} rx={2} fill={BLUE} stroke={INK} strokeWidth={1.5} /><Circle cx={31} cy={20} r={4} fill={YELLOW} stroke={INK} strokeWidth={1.5} /><SvgText x={31} y={22} fontSize={5} fontWeight="bold" fill={INK} textAnchor="middle">T</SvgText><SvgText x={24} y={38} fontSize={6} fontWeight="bold" fill={INK} textAnchor="middle">30mA</SvgText></G>,
  'part.regulator': <G><Rect x={8} y={8} width={32} height={32} rx={6} fill="#FFFFFF" stroke={INK} strokeWidth={2} /><Circle cx={24} cy={24} r={10} fill="#E6E9F2" stroke={INK} strokeWidth={2} /><Line x1={24} y1={24} x2={24} y2={15} stroke={RED} strokeWidth={3} strokeLinecap="round" /><SvgText x={11} y={37} fontSize={6} fill={INK}>1</SvgText><SvgText x={33} y={37} fontSize={6} fill={INK}>5</SvgText></G>,
  'part.socket': <G><Rect x={8} y={8} width={32} height={32} rx={6} fill="#FFFFFF" stroke={INK} strokeWidth={2} /><Circle cx={24} cy={17} r={3.5} fill={INK} /><Circle cx={17} cy={30} r={3} fill={INK} /><Circle cx={31} cy={30} r={3} fill={INK} /></G>,
  'part.stabilizer': <G><Rect x={6} y={10} width={36} height={30} rx={4} fill="#E6E9F2" stroke={INK} strokeWidth={2} /><Path d="M12 30a10 10 0 0 1 20 0" fill="none" stroke={INK} strokeWidth={2} /><Line x1={22} y1={30} x2={27} y2={22} stroke={RED} strokeWidth={2} /><Circle cx={37} cy={18} r={2.5} fill={GREEN} /><Circle cx={37} cy={26} r={2.5} fill={RED} /></G>,
  'part.ptc-relay': <G><Rect x={10} y={12} width={28} height={24} rx={4} fill={BLACK} stroke={INK} strokeWidth={2} /><Circle cx={18} cy={24} r={3} fill={METAL} /><Circle cx={30} cy={24} r={3} fill={METAL} /><SvgText x={24} y={34} fontSize={6} fontWeight="bold" fill="#FFFFFF" textAnchor="middle">PTC</SvgText></G>,
  'part.drain-pump': <G><Circle cx={22} cy={26} r={13} fill="#E6E9F2" stroke={INK} strokeWidth={2} /><Rect x={30} y={8} width={8} height={14} rx={2} fill={PVC} stroke={INK} strokeWidth={2} /><Rect x={4} y={22} width={8} height={8} rx={2} fill={PVC} stroke={INK} strokeWidth={2} /><Path d="M22 18v16M14 26h16" stroke={INK} strokeWidth={2} /></G>,
  'part.belt': <G><Rect x={6} y={14} width={36} height={20} rx={10} fill="none" stroke={BLACK} strokeWidth={5} /><Circle cx={16} cy={24} r={4} fill={METAL} stroke={INK} strokeWidth={1.5} /><Circle cx={32} cy={24} r={6} fill={METAL} stroke={INK} strokeWidth={1.5} /></G>,
  // ---------- carpentry hardware ----------
  'part.hinge': <G><Rect x={8} y={8} width={14} height={32} rx={2} fill={METAL} stroke={INK} strokeWidth={2} /><Rect x={26} y={8} width={14} height={32} rx={2} fill={METAL} stroke={INK} strokeWidth={2} /><Rect x={21} y={8} width={6} height={32} rx={3} fill={STEEL} stroke={INK} strokeWidth={1.5} /><Circle cx={15} cy={16} r={2} fill={INK} /><Circle cx={15} cy={32} r={2} fill={INK} /><Circle cx={33} cy={16} r={2} fill={INK} /><Circle cx={33} cy={32} r={2} fill={INK} /></G>,
  'part.handle': <G><Path d="M8 30h32" stroke={STEEL} strokeWidth={6} strokeLinecap="round" /><Rect x={10} y={30} width={6} height={10} fill={STEEL} stroke={INK} strokeWidth={1.5} /><Rect x={32} y={30} width={6} height={10} fill={STEEL} stroke={INK} strokeWidth={1.5} /></G>,
  'part.l-bracket': <G><Path d="M10 6h10v22h18v10H10z" fill={METAL} stroke={INK} strokeWidth={2} strokeLinejoin="round" /><Circle cx={15} cy={13} r={2} fill={INK} /><Circle cx={15} cy={23} r={2} fill={INK} /><Circle cx={26} cy={33} r={2} fill={INK} /><Circle cx={33} cy={33} r={2} fill={INK} /></G>,
  'part.tower-bolt': <G><Rect x={8} y={16} width={26} height={16} rx={3} fill={BRASS} stroke={INK} strokeWidth={2} /><Rect x={12} y={21} width={32} height={6} rx={3} fill={STEEL} stroke={INK} strokeWidth={1.5} /><Rect x={20} y={10} width={5} height={12} rx={2} fill={STEEL} stroke={INK} strokeWidth={1.5} /></G>,
  'part.wall-plug': <G><Path d="M8 20h28l6 4-6 4H8z" fill={RED} stroke={INK} strokeWidth={2} strokeLinejoin="round" /><Path d="M14 20v8M20 20v8M26 20v8" stroke={INK} strokeWidth={1} /><Rect x={4} y={18} width={5} height={12} rx={1} fill={RED} stroke={INK} strokeWidth={2} /></G>,
  // ---------- hand tools ----------
  'tool.chisel': <G><Rect x={19} y={4} width={10} height={20} rx={4} fill={WOOD} stroke={INK} strokeWidth={2} /><Path d="M20 24h8v14l-4 6-4-6z" fill={METAL} stroke={INK} strokeWidth={2} strokeLinejoin="round" /></G>,
  'tool.clamp': <G><Path d="M10 8h24v6H17v20h17v6H10z" fill={BLUE} stroke={INK} strokeWidth={2} strokeLinejoin="round" /><Line x1={30} y1={14} x2={30} y2={34} stroke={STEEL} strokeWidth={3} /><Rect x={26} y={30} width={10} height={4} fill={STEEL} stroke={INK} strokeWidth={1} /><Rect x={36} y={18} width={8} height={4} rx={2} fill={RED} stroke={INK} strokeWidth={1.5} /></G>,
  'tool.drill': <G><Path d="M8 12h24a6 6 0 0 1 6 6v2a6 6 0 0 1-6 6H20l-2 16h-8l2-16H8z" fill={YELLOW} stroke={INK} strokeWidth={2} strokeLinejoin="round" /><Rect x={38} y={16} width={4} height={6} fill={STEEL} stroke={INK} strokeWidth={1.5} /><Line x1={42} y1={19} x2={47} y2={19} stroke={INK} strokeWidth={2} /></G>,
  'tool.drill-bit': <G><Rect x={21} y={4} width={6} height={14} fill={METAL} stroke={INK} strokeWidth={1.5} /><Path d="M21 18h6v20l-3 6-3-6z" fill={METAL} stroke={INK} strokeWidth={1.5} /><Path d="M21 22l6 4M21 28l6 4M21 34l6 4" stroke={INK} strokeWidth={1.5} /></G>,
  'tool.forstner-bit': <G><Rect x={21} y={4} width={6} height={22} fill={METAL} stroke={INK} strokeWidth={1.5} /><Rect x={10} y={26} width={28} height={10} rx={2} fill={METAL} stroke={INK} strokeWidth={2} /><Path d="M12 36l2 4 2-4M20 36l2 4 2-4M28 36l2 4 2-4" stroke={INK} strokeWidth={1.5} fill="none" /></G>,
  'tool.bending-spring': <G><Path d="M6 24c2-8 4 8 6 0s4 8 6 0 4 8 6 0 4 8 6 0 4 8 6 0 4 8 6 0" fill="none" stroke={STEEL} strokeWidth={3} strokeLinecap="round" /><Circle cx={44} cy={24} r={3} fill={STEEL} /></G>,
  'tool.hacksaw': <G><Path d="M8 14h30v20" fill="none" stroke={BLUE} strokeWidth={4} strokeLinejoin="round" /><Line x1={8} y1={14} x2={8} y2={30} stroke={BLUE} strokeWidth={4} /><Line x1={8} y1={30} x2={38} y2={30} stroke={STEEL} strokeWidth={2} strokeDasharray="2 1" /><Rect x={36} y={30} width={8} height={12} rx={3} fill={RED} stroke={INK} strokeWidth={1.5} /></G>,
  'tool.pipe-cutter': <G><Path d="M10 10h22a6 6 0 0 1 6 6v8H30v-6H18v18h-8z" fill={RED} stroke={INK} strokeWidth={2} strokeLinejoin="round" /><Circle cx={24} cy={24} r={5} fill={METAL} stroke={INK} strokeWidth={1.5} /><Rect x={28} y={24} width={6} height={18} rx={2} fill={STEEL} stroke={INK} strokeWidth={1.5} /></G>,
  'tool.plunger': <G><Rect x={22} y={4} width={4} height={26} rx={2} fill={WOOD} stroke={INK} strokeWidth={1.5} /><Path d="M10 42c0-10 6-14 14-14s14 4 14 14z" fill={RED} stroke={INK} strokeWidth={2} /></G>,
  'tool.spirit-level': <G><Rect x={4} y={18} width={40} height={12} rx={3} fill={YELLOW} stroke={INK} strokeWidth={2} /><Rect x={18} y={20} width={12} height={8} rx={4} fill="#C9F0B0" stroke={INK} strokeWidth={1.5} /><Circle cx={24} cy={24} r={2} fill="#FFFFFF" stroke={INK} strokeWidth={1} /></G>,
  'tool.plane': <G><Path d="M6 32l6-12h26l4 12z" fill={WOOD} stroke={INK} strokeWidth={2} strokeLinejoin="round" /><Rect x={6} y={32} width={36} height={6} fill={STEEL} stroke={INK} strokeWidth={1.5} /><Circle cx={14} cy={18} r={4} fill={WOOD} stroke={INK} strokeWidth={1.5} /><Path d="M28 20l4-8h6l-2 8" fill={WOOD} stroke={INK} strokeWidth={1.5} /></G>,
  'tool.scraper': <G><Rect x={20} y={4} width={8} height={22} rx={3} fill={BLUE} stroke={INK} strokeWidth={2} /><Path d="M14 26h20l-2 16H16z" fill={METAL} stroke={INK} strokeWidth={2} strokeLinejoin="round" /></G>,
  'tool.wire-brush': <G><Rect x={6} y={10} width={36} height={10} rx={3} fill={WOOD} stroke={INK} strokeWidth={2} /><Path d="M10 20v14M14 20v14M18 20v14M22 20v14M26 20v14M30 20v14M34 20v14M38 20v14" stroke={STEEL} strokeWidth={2} /></G>,
  'tool.wire-stripper': <G><Path d="M18 4l6 18 6-18" fill="none" stroke={STEEL} strokeWidth={4} strokeLinecap="round" /><Path d="M20 26l-6 18M28 26l6 18" stroke={YELLOW} strokeWidth={6} strokeLinecap="round" /><Circle cx={24} cy={24} r={3} fill={INK} /><Circle cx={22} cy={12} r={1.5} fill="#FFFFFF" /></G>,
  'tool.insulation-tape': <G><Circle cx={24} cy={24} r={16} fill={BLACK} stroke={INK} strokeWidth={2} /><Circle cx={24} cy={24} r={7} fill="#FFFFFF" stroke={INK} strokeWidth={2} /><Path d="M38 30l8 6" stroke={BLACK} strokeWidth={5} /></G>,
  'tool.ptfe-tape': <G><Circle cx={24} cy={24} r={16} fill="#FFFFFF" stroke={INK} strokeWidth={2} /><Circle cx={24} cy={24} r={8} fill={YELLOW} stroke={INK} strokeWidth={2} /><Circle cx={24} cy={24} r={13} fill="none" stroke="#D5D9E5" strokeWidth={1} /></G>,
  'tool.extension-pole': <G><Line x1={8} y1={44} x2={36} y2={12} stroke={STEEL} strokeWidth={4} strokeLinecap="round" /><Path d="M30 8c4-6 14-4 14 4s-8 8-12 6" fill="#B58AE0" stroke={INK} strokeWidth={2} /></G>,
  'tool.torque-wrench': <G><Line x1={6} y1={40} x2={34} y2={12} stroke={STEEL} strokeWidth={6} strokeLinecap="round" /><Circle cx={38} cy={9} r={6} fill={METAL} stroke={INK} strokeWidth={2} /><Circle cx={18} cy={28} r={6} fill="#FFFFFF" stroke={INK} strokeWidth={1.5} /><Line x1={18} y1={28} x2={21} y2={24} stroke={RED} strokeWidth={1.5} /></G>,
  'tool.flaring-tool': <G><Rect x={4} y={28} width={40} height={10} rx={2} fill={METAL} stroke={INK} strokeWidth={2} /><Circle cx={12} cy={33} r={2.5} fill={INK} /><Circle cx={20} cy={33} r={3} fill={INK} /><Circle cx={28} cy={33} r={3.5} fill={INK} /><Path d="M30 28l4-10h6l4 10" fill={STEEL} stroke={INK} strokeWidth={2} /><Path d="M37 18V6" stroke={INK} strokeWidth={3} /><Line x1={30} y1={6} x2={44} y2={6} stroke={INK} strokeWidth={3} /></G>,
  'tool.discharge-probe': <G><Rect x={6} y={30} width={20} height={10} rx={4} fill={RED} stroke={INK} strokeWidth={2} /><Line x1={26} y1={35} x2={44} y2={20} stroke={STEEL} strokeWidth={3} strokeLinecap="round" /><Path d="M6 35c-4 4-2 10 6 10h14" fill="none" stroke={GREEN} strokeWidth={2} /><Rect x={24} y={41} width={8} height={5} fill={STEEL} /></G>,
  'tool.tester': <G><Rect x={18} y={20} width={12} height={24} rx={4} fill="#CDE8FF" stroke={INK} strokeWidth={2} /><Circle cx={24} cy={30} r={3} fill="#FF5A3C" /><Path d="M22 20V6h4v14" fill={STEEL} stroke={INK} strokeWidth={1.5} /></G>,
  // ---------- meters ----------
  'tool.multimeter': meter(<G><Circle cx={24} cy={36} r={5} fill={BLACK} /><Line x1={24} y1={36} x2={27} y2={33} stroke="#FFFFFF" strokeWidth={1.5} /><SvgText x={24} y={26} fontSize={6} fontWeight="bold" fill={INK} textAnchor="middle">230</SvgText></G>, <G><Path d="M14 44c-6 0-8-4-8-10" stroke={RED} strokeWidth={2} fill="none" /><Path d="M34 44c6 0 8-4 8-10" stroke={BLACK} strokeWidth={2} fill="none" /></G>),
  'tool.clamp-meter': meter(<SvgText x={24} y={26} fontSize={6} fontWeight="bold" fill={INK} textAnchor="middle">8.9A</SvgText>, <Path d="M16 16a10 10 0 1 1 16 0" fill="none" stroke={RED} strokeWidth={4} strokeLinecap="round" />),
  'tool.earth-tester': meter(<SvgText x={24} y={26} fontSize={6} fontWeight="bold" fill={INK} textAnchor="middle">1.2Ω</SvgText>, <G><Path d="M4 44l4-12M44 44l-4-12" stroke={STEEL} strokeWidth={3} /><Path d="M8 32c4-4 4-10 4-14M40 32c-4-4-4-10-4-14" stroke={GREEN} strokeWidth={1.5} fill="none" /></G>, '#F07A12'),
  'tool.megger': meter(<SvgText x={24} y={26} fontSize={6} fontWeight="bold" fill={INK} textAnchor="middle">MΩ</SvgText>, <G><Line x1={36} y1={30} x2={44} y2={30} stroke={INK} strokeWidth={3} /><Line x1={44} y1={30} x2={44} y2={22} stroke={INK} strokeWidth={3} /></G>, RED),
  'tool.phase-meter': meter(<G><Circle cx={18} cy={36} r={3} fill={RED} /><Circle cx={24} cy={36} r={3} fill={YELLOW} /><Circle cx={30} cy={36} r={3} fill={BLUE} /><Path d="M19 23a5 5 0 1 1 10 0" stroke={INK} strokeWidth={1.5} fill="none" /></G>, undefined, '#7AD1C0'),
  'tool.leak-detector': meter(<SvgText x={24} y={26} fontSize={5} fontWeight="bold" fill={INK} textAnchor="middle">LEAK</SvgText>, <G><Line x1={24} y1={14} x2={34} y2={2} stroke={STEEL} strokeWidth={2.5} /><Path d="M38 4a6 6 0 0 1 2 6M40 0a10 10 0 0 1 4 10" stroke={RED} strokeWidth={1.5} fill="none" /></G>, '#2FB5A0'),
  'tool.wire-detector': <G><Rect x={10} y={12} width={28} height={30} rx={8} fill={YELLOW} stroke={INK} strokeWidth={2} /><Rect x={16} y={18} width={16} height={8} rx={2} fill="#E6F4EA" stroke={INK} strokeWidth={1.5} /><Path d="M16 34a8 8 0 0 1 16 0M19 36a5 5 0 0 1 10 0" stroke={RED} strokeWidth={1.5} fill="none" /><Path d="M2 46h44" stroke={RED} strokeWidth={2} strokeDasharray="4 2" /></G>,
  // ---------- machines and gas ----------
  'tool.vacuum-pump': <G><Rect x={6} y={18} width={30} height={22} rx={4} fill="#2F5BD6" stroke={INK} strokeWidth={2} /><Rect x={14} y={10} width={14} height={8} rx={2} fill={STEEL} stroke={INK} strokeWidth={1.5} /><Circle cx={36} cy={14} r={7} fill="#FFFFFF" stroke={INK} strokeWidth={2} /><Line x1={36} y1={14} x2={33} y2={11} stroke={RED} strokeWidth={1.5} /><Path d="M10 24h22M10 28h22M10 32h22" stroke="#FFFFFF" strokeWidth={1} /></G>,
  'tool.recovery-machine': <G><Rect x={6} y={14} width={36} height={28} rx={4} fill={GREEN} stroke={INK} strokeWidth={2} /><Circle cx={16} cy={26} r={6} fill="#FFFFFF" stroke={INK} strokeWidth={1.5} /><Circle cx={32} cy={26} r={6} fill="#FFFFFF" stroke={INK} strokeWidth={1.5} /><Line x1={16} y1={26} x2={19} y2={23} stroke={BLUE} strokeWidth={1.5} /><Line x1={32} y1={26} x2={35} y2={23} stroke={RED} strokeWidth={1.5} /><Rect x={16} y={8} width={16} height={6} rx={2} fill={STEEL} stroke={INK} strokeWidth={1.5} /></G>,
  'tool.nitrogen': cylinder('#5E6577', BLACK, 'N₂'),
  'tool.oxygen': cylinder(BLACK, '#FFFFFF', 'O₂'),
  'tool.lpg': cylinder(RED, STEEL, 'LPG'),
  'tool.router': <G><Rect x={12} y={6} width={24} height={22} rx={6} fill="#F07A12" stroke={INK} strokeWidth={2} /><Rect x={8} y={28} width={32} height={6} rx={2} fill={STEEL} stroke={INK} strokeWidth={1.5} /><Rect x={22} y={34} width={4} height={8} fill={METAL} stroke={INK} strokeWidth={1} /><Path d="M20 42h8l-2 4h-4z" fill={METAL} stroke={INK} strokeWidth={1} /></G>,
  'tool.steam-cleaner': <G><Rect x={8} y={22} width={22} height={20} rx={6} fill="#3DB5E6" stroke={INK} strokeWidth={2} /><Path d="M30 30h8l4-6" stroke={INK} strokeWidth={3} fill="none" /><Path d="M40 16c-2-3 2-4 0-7M44 18c-2-3 2-4 0-7M36 16c-2-3 2-4 0-7" stroke="#9AA3B8" strokeWidth={2} fill="none" /></G>,
  'tool.wet-vacuum': <G><Rect x={8} y={18} width={22} height={24} rx={6} fill="#5B6BD6" stroke={INK} strokeWidth={2} /><Path d="M30 24c10 0 12 6 12 16" stroke={INK} strokeWidth={3} fill="none" /><Path d="M18 26c-3 4-3 7 0 8s3-4 0-8z" fill="#9AD6FF" stroke="#FFFFFF" strokeWidth={1} /></G>,
  'tool.carpet-machine': <G><Line x1={30} y1={4} x2={24} y2={30} stroke={STEEL} strokeWidth={3} /><Rect x={26} y={2} width={10} height={4} rx={2} fill={INK} /><Rect x={10} y={28} width={30} height={12} rx={4} fill={RED} stroke={INK} strokeWidth={2} /><Path d="M8 44h34" stroke="#8A5BD6" strokeWidth={4} /><Path d="M14 40v4M22 40v4M30 40v4" stroke={INK} strokeWidth={1.5} /></G>,
};
