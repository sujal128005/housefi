// The festive look of the home screens, one per greeting theme (the server picks the festival: catalog/greeting):
// the header wash, the glowing arch behind the festival's name, the coupon strip, and the 3D art that sits on the arch
// (assets/icons3d, made by tools/icons3d). A theme the app does not know gets the plain "sparkle" look.
import type { Art3DIconName } from './Art3D';

export interface FestiveLook {
  /** The header wash, top to bottom (it fades into the canvas below). */
  readonly wash: readonly [string, string];
  /** The glowing arch: its top and its base (the base melts into the wash). */
  readonly dome: readonly [string, string];
  /** The festival's name: a cream face with a deep, solid shadow (like lettering on a festive card). */
  readonly title: string;
  readonly titleShadow: string;
  /** Small words on the wash: "housefi" over the name, "BOOK NOW", the strip's headline. */
  readonly deep: string;
  /** The strip's button and the coupon ticket's edge. */
  readonly button: string;
  /** Sparkles and confetti. */
  readonly accent: string;
  /** The coupon strip, left to right. */
  readonly strip: readonly [string, string];
  /** 3D art on the arch: the big piece on the left, a smaller one in front. */
  readonly art: readonly [Art3DIconName, Art3DIconName];
}

const DIWALI: FestiveLook = {
  wash: ['#C3BCFF', '#F6CBEA'], dome: ['#F9C4E8', '#EC9FD8'], title: '#FFF7E4', titleShadow: '#B3247C', deep: '#3D1680',
  button: '#E2338E', accent: '#FFC23A', strip: ['#EEDCFF', '#FFE0F0'], art: ['gift', 'diya'],
};

const LOOKS: Readonly<Record<string, FestiveLook>> = {
  // Diwali, Christmas and New Year: periwinkle into pink, a pink arch, gifts and a lamp.
  lights: DIWALI,
  kites: { ...DIWALI, wash: ['#B8DDFF', '#FFE6B0'], dome: ['#FFF6DA', '#FFD98A'], titleShadow: '#1E63FF', deep: '#0A3CF5', button: '#1E63FF', strip: ['#DDEEFF', '#FFF0C9'], art: ['sun', 'gift'] },
  moon: { ...DIWALI, wash: ['#BFE7D5', '#F4E3B5'], dome: ['#FFF7DD', '#E9D08A'], titleShadow: '#0E6B4B', deep: '#0B4A35', button: '#0E8A5F', strip: ['#DDF3E8', '#FBF0D2'], art: ['moon', 'gift'] },
  colours: { ...DIWALI, wash: ['#FFC2E1', '#D6C6FF'], dome: ['#FFF0F7', '#FFB3D9'], titleShadow: '#C21A73', deep: '#6A1B9A', button: '#E2338E', strip: ['#FFE0F0', '#E9DEFF'], art: ['party', 'gift'] },
  leaves: { ...DIWALI, wash: ['#CDEDB4', '#FFE6A8'], dome: ['#FBFFE8', '#D9F0A0'], titleShadow: '#2E7D1F', deep: '#245A12', button: '#3E9B1F', strip: ['#E5F6D6', '#FFF0C9'], art: ['house_garden', 'sun'] },
  flag: { ...DIWALI, wash: ['#FFD6B0', '#CDEFD2'], dome: ['#FFFFFF', '#FFE2C2'], titleShadow: '#0A2A8C', deep: '#0A2A8C', button: '#138808', strip: ['#FFE8D4', '#DDF4E0'], art: ['trophy', 'sparkles'] },
  flowers: { ...DIWALI, wash: ['#FFC6DD', '#DCCBFF'], dome: ['#FFF0F6', '#FFB0D0'], titleShadow: '#B0175A', deep: '#6D2BD9', button: '#D61F78', strip: ['#FFE0EC', '#EDE3FF'], art: ['party', 'gift'] },
  sparkle: { ...DIWALI, wash: ['#C9D4FF', '#F2D4F5'], dome: ['#F5F7FF', '#C9D6FF'], titleShadow: '#0A3CF5', deep: '#0A3CF5', button: '#0A3CF5', strip: ['#E3E9FF', '#F6E6FA'], art: ['gift', 'sparkles'] },
};

export function festiveLook(theme: string): FestiveLook {
  return LOOKS[theme] ?? LOOKS.sparkle!;
}
