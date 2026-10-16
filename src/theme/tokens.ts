// Housefi design tokens, taken from the finalized logo (assets/brand): cobalt blue for primary actions and brand
// moments, cyan as the secondary accent, warm amber / orange for selective highlights (like the logo's arc), clean
// ivory and white surfaces, and deep navy text. Gradients are used selectively (headers, primary buttons, icon tiles),
// never on every surface. Token names are semantic and stable; `navy` is the primary brand colour (cobalt).

export const colors = {
  canvas: '#FAF9F5',
  surface: '#FFFFFF',
  surfaceMuted: '#F2F1EB',
  ink: '#0B1B3F',
  inkMuted: '#4E5A77',
  inkSubtle: '#8790A8',
  line: '#E7E5DE',
  lineStrong: '#D2D0C7',

  navy: '#0A3CF5',
  navyPressed: '#062DC4',
  violetDeep: '#0626B5',
  onNavy: '#FFFFFF',
  /** Secondary text on cobalt. */
  onNavyMuted: 'rgba(255,255,255,0.8)',
  /** Frosted panel on cobalt. */
  glass: 'rgba(255,255,255,0.15)',
  glassLine: 'rgba(255,255,255,0.24)',
  blue: '#1E63FF',
  blueTint: '#E8F0FF',
  onBlueTint: '#0A35C4',
  cyan: '#00B2EE',
  cyanTint: '#E0F6FE',

  amber: '#FFB21C',
  amberPressed: '#F09E00',
  onAmber: '#2B1A00',
  /** The "9" in Nexara9. */
  gold: '#E9A600',

  success: '#119A57',
  successTint: '#E4F7ED',
  onSuccessTint: '#0A6A3A',
  warning: '#B26A00',
  warningTint: '#FFF3DC',
  onWarningTint: '#7A4A00',
  danger: '#DE3A40',
  dangerTint: '#FDEBEC',
  onDangerTint: '#A3262B',

  orange: '#FF7A0A',
  yellow: '#FFB000',
  pink: '#F04F8C',
  demo: '#6B4FCF',
  demoTint: '#F0ECFF',

  overlay: 'rgba(11, 27, 63, 0.5)',
  shadow: '#0A2A8F',
} as const;

/** Soft washes behind hero areas (top-left to bottom-right). `navy` is the cobalt brand gradient. */
export const washes = {
  lavender: ['#EAF1FF', '#F8FAFF'],
  peach: ['#FFF0E0', '#FFF9F1'],
  mint: ['#E2F7EF', '#F4FCF8'],
  sky: ['#DFF5FE', '#F5FBFF'],
  sunrise: ['#FFF1DF', '#EAF2FF'],
  navy: ['#1E7BFF', '#0730D9'],
} as const;

/** The brand gradient used for headers and the primary button (cyan-blue at the top-left, cobalt below). */
export const BRAND_GRADIENT = ['#1E86FF', '#0A3CF5', '#0628C9'] as const;

export type WashName = keyof typeof washes;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, x3: 32, x4: 40, x5: 56 } as const;
/** `icon`: the soft square chip behind functional icons in rows and lists (40 pt). */
export const radius = { icon: 12, sm: 10, md: 14, lg: 18, xl: 22, xxl: 28, pill: 999 } as const;

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
  hero: { size: 36, line: 40, weight: 'extrabold', tracking: -0.6 },
  title1: { size: 29, line: 34, weight: 'bold', tracking: -0.4 },
  title2: { size: 23, line: 28, weight: 'bold', tracking: -0.2 },
  title3: { size: 19, line: 24, weight: 'bold' },
  body: { size: 17, line: 24, weight: 'regular' },
  bodyStrong: { size: 17, line: 24, weight: 'semibold' },
  callout: { size: 16, line: 22, weight: 'medium' },
  label: { size: 15, line: 20, weight: 'semibold' },
  footnote: { size: 14, line: 19, weight: 'regular' },
  caption: { size: 12.5, line: 16, weight: 'semibold', tracking: 0.2 },
  price: { size: 34, line: 38, weight: 'extrabold', tracking: -0.5 },
};

export const shadow = {
  card: { shadowColor: colors.shadow, shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  raised: { shadowColor: colors.shadow, shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  button: { shadowColor: colors.navy, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  glow: { shadowColor: colors.navy, shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
} as const;

export const motion = { fast: 140, base: 240, slow: 420 } as const;
