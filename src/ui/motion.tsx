// Motion helpers. Every animation respects the phone's "reduce motion" setting.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v)).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Fades and slides content up when it first appears. */
export function Appear({ children, delay = 0, style, from = 14 }: { readonly children: ReactNode; readonly delay?: number; readonly style?: StyleProp<ViewStyle>; readonly from?: number }) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduce ? 0 : 420, delay: reduce ? 0 : delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay, reduce]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Pops content in with a little overshoot (success moments). */
export function Pop({ children, delay = 0, style }: { readonly children: ReactNode; readonly delay?: number; readonly style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0.6)).current;
  const o = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.parallel([
      Animated.spring(v, { toValue: 1, delay, useNativeDriver: true, speed: 9, bounciness: 12 }),
      Animated.timing(o, { toValue: 1, duration: 220, delay, useNativeDriver: true }),
    ]).start();
  }, [v, o, delay, reduce]);
  return <Animated.View style={[style, { opacity: o, transform: [{ scale: v }] }]}>{children}</Animated.View>;
}

/** Slides content in from the left edge to its place (e.g. the technician's scooter arriving). */
export function RideIn({ children, distance = 260, style, onDone }: { readonly children: ReactNode; readonly distance?: number; readonly style?: StyleProp<ViewStyle>; readonly onDone?: () => void }) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(reduce ? 0 : -distance)).current;
  const tilt = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) {
      onDone?.();
      return;
    }
    Animated.sequence([
      Animated.timing(v, { toValue: 0, duration: 1300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(tilt, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.spring(tilt, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 14 }),
      ]),
    ]).start(() => onDone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, tilt, reduce]);
  const rotate = tilt.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-6deg'] });
  return <Animated.View style={[style, { transform: [{ translateX: v }, { rotate }] }]}>{children}</Animated.View>;
}

/** Soft expanding rings (searching, live location). */
export function Pulse({ size, color, style }: { readonly size: number; readonly color: string; readonly style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v, reduce]);
  if (reduce) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.35] }) }] }, style]}
    />
  );
}
