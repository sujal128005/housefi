import { Platform } from 'react-native';

/** Hides decorative art from screen readers (native props on phones, aria-hidden on the web preview). */
export const decorative = Platform.OS === 'web'
  ? ({ 'aria-hidden': true } as Record<string, unknown>)
  : ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as Record<string, unknown>);
