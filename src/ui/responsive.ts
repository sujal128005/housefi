// One place for screen-size decisions, so the app reads well on a 320 dp phone, a 430 dp phone and a tablet:
// - content keeps a comfortable reading width and is centred on large screens,
// - side padding and type scale a little with the width,
// - grids add columns on wider screens.
import { useWindowDimensions } from 'react-native';

/** Widest the main content column gets (tablets, landscape, foldables). */
export const MAX_CONTENT = 680;

export interface Layout {
  readonly width: number;
  readonly height: number;
  /** Narrow phones (iPhone SE, small Androids). */
  readonly compact: boolean;
  /** Tablets and unfolded foldables. */
  readonly tablet: boolean;
  /** Width of the content column (screen width minus gutters, capped). */
  readonly content: number;
  readonly gutter: number;
  /** Multiplier for type sizes, about 0.92-1.08. */
  readonly typeScale: number;
  /** Columns for a grid of tiles, given the phone count. */
  readonly columns: (phone: number) => number;
}

export function layoutFor(width: number, height: number): Layout {
  const compact = width < 360;
  const tablet = Math.min(width, height) >= 600;
  const gutter = compact ? 16 : tablet ? 28 : 20;
  const content = Math.min(width, MAX_CONTENT) - gutter * 2;
  const typeScale = tablet ? 1.08 : Math.max(0.92, Math.min(1.04, width / 390));
  return {
    width, height, compact, tablet, content, gutter, typeScale,
    columns: (phone) => (tablet ? Math.max(phone, Math.floor(content / 150)) : compact ? Math.max(2, phone - 1) : phone),
  };
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return layoutFor(width, height);
}
