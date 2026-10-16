// Anek Latin for English and Anek Telugu for Telugu: one type family (Ek Type) designed for both scripts, so the two
// languages look like the same brand. Confident, slightly condensed shapes that stay readable at small sizes.
// SIL Open Font License, bundled with the app.
import { AnekLatin_400Regular } from '@expo-google-fonts/anek-latin/400Regular';
import { AnekLatin_500Medium } from '@expo-google-fonts/anek-latin/500Medium';
import { AnekLatin_600SemiBold } from '@expo-google-fonts/anek-latin/600SemiBold';
import { AnekLatin_700Bold } from '@expo-google-fonts/anek-latin/700Bold';
import { AnekLatin_800ExtraBold } from '@expo-google-fonts/anek-latin/800ExtraBold';
import { AnekTelugu_400Regular } from '@expo-google-fonts/anek-telugu/400Regular';
import { AnekTelugu_500Medium } from '@expo-google-fonts/anek-telugu/500Medium';
import { AnekTelugu_600SemiBold } from '@expo-google-fonts/anek-telugu/600SemiBold';
import { AnekTelugu_700Bold } from '@expo-google-fonts/anek-telugu/700Bold';
import { AnekTelugu_800ExtraBold } from '@expo-google-fonts/anek-telugu/800ExtraBold';
import type { Locale } from '../i18n/format';
import type { FontWeight } from './tokens';

export const FONT_ASSETS = {
  AnekLatin_400Regular,
  AnekLatin_500Medium,
  AnekLatin_600SemiBold,
  AnekLatin_700Bold,
  AnekLatin_800ExtraBold,
  AnekTelugu_400Regular,
  AnekTelugu_500Medium,
  AnekTelugu_600SemiBold,
  AnekTelugu_700Bold,
  AnekTelugu_800ExtraBold,
};

const LATIN: Record<FontWeight, keyof typeof FONT_ASSETS> = {
  regular: 'AnekLatin_400Regular',
  medium: 'AnekLatin_500Medium',
  semibold: 'AnekLatin_600SemiBold',
  bold: 'AnekLatin_700Bold',
  extrabold: 'AnekLatin_800ExtraBold',
};

const TELUGU: Record<FontWeight, keyof typeof FONT_ASSETS> = {
  regular: 'AnekTelugu_400Regular',
  medium: 'AnekTelugu_500Medium',
  semibold: 'AnekTelugu_600SemiBold',
  bold: 'AnekTelugu_700Bold',
  extrabold: 'AnekTelugu_800ExtraBold',
};

export function fontFamily(weight: FontWeight, locale: Locale): string {
  return (locale === 'te' ? TELUGU : LATIN)[weight];
}
