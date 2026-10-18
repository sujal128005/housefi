import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { colors } from '../theme/tokens';
import type { TextColor } from './Txt';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Ionicons: rounded, familiar on both platforms. Decorative by default (hidden from screen readers). */
export function Icon({ name, size = 22, color = 'ink' }: { readonly name: IconName; readonly size?: number; readonly color?: TextColor }) {
  return <Ionicons name={name} size={size} color={colors[color]} accessibilityElementsHidden importantForAccessibility="no" />;
}
