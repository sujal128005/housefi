// Plus Jakarta Sans for English (geometric, friendly, bold headings like the reference) and Noto Sans Telugu for
// Telugu. Both are SIL Open Font License fonts bundled with the app.
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';
import { NotoSansTelugu_400Regular } from '@expo-google-fonts/noto-sans-telugu/400Regular';
import { NotoSansTelugu_500Medium } from '@expo-google-fonts/noto-sans-telugu/500Medium';
import { NotoSansTelugu_600SemiBold } from '@expo-google-fonts/noto-sans-telugu/600SemiBold';
import { NotoSansTelugu_700Bold } from '@expo-google-fonts/noto-sans-telugu/700Bold';
import { NotoSansTelugu_800ExtraBold } from '@expo-google-fonts/noto-sans-telugu/800ExtraBold';
import type { Locale } from '../i18n/format';
import type { FontWeight } from './tokens';

export const FONT_ASSETS = {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  NotoSansTelugu_400Regular,
  NotoSansTelugu_500Medium,
  NotoSansTelugu_600SemiBold,
  NotoSansTelugu_700Bold,
  NotoSansTelugu_800ExtraBold,
};

const LATIN: Record<FontWeight, keyof typeof FONT_ASSETS> = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

const TELUGU: Record<FontWeight, keyof typeof FONT_ASSETS> = {
  regular: 'NotoSansTelugu_400Regular',
  medium: 'NotoSansTelugu_500Medium',
  semibold: 'NotoSansTelugu_600SemiBold',
  bold: 'NotoSansTelugu_700Bold',
  extrabold: 'NotoSansTelugu_800ExtraBold',
};

export function fontFamily(weight: FontWeight, locale: Locale): string {
  return (locale === 'te' ? TELUGU : LATIN)[weight];
}
