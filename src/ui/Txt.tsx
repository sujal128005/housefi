import { Text, useWindowDimensions, type TextProps, type TextStyle } from 'react-native';
import type { Locale } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { fontFamily } from '../theme/fonts';
import { colors, text, type FontWeight, type TextVariant } from '../theme/tokens';
import { layoutFor } from './responsive';

export type TextColor = keyof typeof colors;

export interface TxtProps extends TextProps {
  readonly variant?: TextVariant;
  readonly color?: TextColor;
  readonly weight?: FontWeight;
  readonly align?: TextStyle['textAlign'];
  /** Marks the text as a heading for screen readers. */
  readonly heading?: boolean;
  /** Render in this language's font regardless of the UI language (e.g. "తెలుగు" on the language picker). */
  readonly lang?: Locale;
}

/**
 * All app text goes through here: it picks the font for the current language, and gives Telugu more line height and
 * no negative tracking (Telugu vowel signs sit above and below the line; tracking breaks conjuncts). Sizes scale a
 * little with the screen width (smaller on narrow phones, larger on tablets).
 */
export function Txt({ variant = 'body', color = 'ink', weight, align, heading, lang, style, ...rest }: TxtProps) {
  const ui = useI18n().locale;
  const locale = lang ?? ui;
  const spec = text[variant];
  const te = locale === 'te';
  const { width, height } = useWindowDimensions();
  const k = layoutFor(width, height).typeScale;
  const size = Math.round((te && spec.size >= 21 ? spec.size - 2 : spec.size) * k);
  const line = Math.round(spec.line * k);
  return (
    <Text
      accessibilityRole={heading ? 'header' : rest.accessibilityRole}
      maxFontSizeMultiplier={1.6}
      style={[
        {
          fontFamily: fontFamily(weight ?? spec.weight, locale),
          fontSize: size,
          lineHeight: te ? Math.round(line * 1.28) : line,
          letterSpacing: te ? 0 : (spec.tracking ?? 0),
          color: colors[color],
          textAlign: align,
        },
        style,
      ]}
      {...rest}
    />
  );
}
