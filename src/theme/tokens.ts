// Housefi design tokens, taken from the approved UI reference: deep navy for primary actions, royal blue for selection
// and links, green only for success / assigned states, warm orange and yellow inside illustrations, and soft pastel
// washes behind hero areas. Light theme only for now (the reference is light).

export const colors = {
  canvas: '#F6F7FC',
  surface: '#FFFFFF',
  surfaceMuted: '#F0F2F9',
  ink: '#101833',
  inkMuted: '#5A6380',
  inkSubtle: '#8F97B0',
  line: '#E5E8F2',
  lineStrong: '#CDD3E4',

  navy: '#13235B',
  navyPressed: '#0C1842',
  onNavy: '#FFFFFF',
  blue: '#2F66F0',
  blueTint: '#EAF0FF',
  onBlueTint: '#1D47B8',

  success: '#178A50',
  successTint: '#E5F6EC',
  onSuccessTint: '#0E6A3B',
  warning: '#B26A00',
  warningTint: '#FFF4DF',
  onWarningTint: '#7A4A00',
  danger: '#D33A3F',
  dangerTint: '#FDECEC',
  onDangerTint: '#A3262B',

  orange: '#FF8A3D',
  yellow: '#FFC93C',
  demo: '#7B4DDB',
  demoTint: '#F2ECFF',

  overlay: 'rgba(16, 24, 51, 0.45)',
  shadow: '#1B2A6B',
} as const;

/** Pastel washes used behind hero illustrations (top-left to bottom-right). */
export const washes = {
  lavender: ['#EFEAFF', '#F8F6FF'],
  peach: ['#FFF0E3', '#FFF8F2'],
  mint: ['#E3F8EF', '#F4FCF8'],
  sky: ['#E5F0FF', '#F5F9FF'],
  sunrise: ['#FFF3E0', '#F0EDFF'],
  navy: ['#1A2D73', '#13235B'],
} as const;

export type WashName = keyof typeof washes;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, x3: 32, x4: 40, x5: 56 } as const;
export const radius = { sm: 10, md: 14, lg: 18, xl: 22, xxl: 28, pill: 999 } as const;

/** Side padding of every screen. */
export const GUTTER = 20;
/** Minimum touch target: 48 dp on Android, which also clears iOS's 44 pt. */
export const TOUCH = 48;

export type FontWeight = 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold';

export type TextVariant = 'hero' | 'title1' | 'title2' | 'title3' | 'body' | 'bodyStrong' | 'callout' | 'label' | 'footnote' | 'caption' | 'price';

export interface TextSpec {
  readonly size: number;
  readonly line: number;
  readonly weight: FontWeight;
  readonly tracking?: number;
}

export const text: Readonly<Record<TextVariant, TextSpec>> = {
  hero: { size: 32, line: 38, weight: 'extrabold', tracking: -0.8 },
  title1: { size: 26, line: 32, weight: 'extrabold', tracking: -0.5 },
  title2: { size: 21, line: 27, weight: 'bold', tracking: -0.3 },
  title3: { size: 18, line: 24, weight: 'bold', tracking: -0.2 },
  body: { size: 16, line: 23, weight: 'regular' },
  bodyStrong: { size: 16, line: 23, weight: 'semibold' },
  callout: { size: 15, line: 21, weight: 'medium' },
  label: { size: 14, line: 19, weight: 'semibold' },
  footnote: { size: 13, line: 18, weight: 'regular' },
  caption: { size: 12, line: 16, weight: 'semibold', tracking: 0.2 },
  price: { size: 30, line: 36, weight: 'extrabold', tracking: -0.6 },
};

export const shadow = {
  card: { shadowColor: colors.shadow, shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  raised: { shadowColor: colors.shadow, shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  button: { shadowColor: colors.navy, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
} as const;

export const motion = { fast: 140, base: 240, slow: 420 } as const;
