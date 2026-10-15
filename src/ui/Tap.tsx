import * as Haptics from 'expo-haptics';
import { useRef, type ReactNode } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface TapProps extends Omit<PressableProps, 'style' | 'children'> {
  readonly style?: StyleProp<ViewStyle>;
  readonly children: ReactNode;
  /** How far the element shrinks while pressed. */
  readonly scale?: number;
  readonly haptic?: boolean;
}

/** A pressable that gives a soft "press-in" shrink and an optional light haptic, used by every tappable surface. */
export function Tap({ style, children, scale = 0.97, haptic = false, onPressIn, onPressOut, onPress, disabled, ...rest }: TapProps) {
  const v = useRef(new Animated.Value(1)).current;
  const to = (value: number) => Animated.spring(v, { toValue: value, useNativeDriver: true, speed: 40, bounciness: 4 }).start();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPressIn={(e) => {
        to(scale);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) void Haptics.selectionAsync().catch(() => undefined);
        onPress?.(e);
      }}
      style={[style, { transform: [{ scale: v }] }]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
