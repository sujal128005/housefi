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

/** Brand confetti colours: the logo's cobalt, cyan and amber, plus the success green. */
const BURST = ['#0A45F5', '#06BFF8', '#FFB21C', '#FF8A10', '#1FBF6A', '#5AA9FF'];

/**
 * Success moment: the content pops in while a ring opens and small pieces of confetti fly out once around it
 * (booking confirmed, payment done, verified, job done). Everything runs on the native thread.
 */
export function Celebrate({ children, size, delay = 120, style }: { readonly children: ReactNode; readonly size: number; readonly delay?: number; readonly style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(v, { toValue: 1, duration: 900, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay, reduce]);
  const pieces = 14;
  return (
    <Animated.View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {reduce ? null : (
        <>
          <Animated.View pointerEvents="none" style={{
            position: 'absolute', width: size, height: size, borderRadius: size, borderWidth: 3, borderColor: '#1FBF6A',
            opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.6, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.3] }) }],
          }} />
          {Array.from({ length: pieces }, (_, i) => {
            const a = (i / pieces) * Math.PI * 2 + (i % 2 ? 0.18 : 0);
            const reach = size * (i % 3 === 0 ? 0.72 : 0.6);
            const dot = i % 3 === 0 ? 10 : 7;
            return (
              <Animated.View key={i} pointerEvents="none" style={{
                position: 'absolute', width: i % 2 ? dot : dot * 1.8, height: dot, borderRadius: dot / 2, backgroundColor: BURST[i % BURST.length],
                opacity: v.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] }),
                transform: [
                  { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * reach] }) },
                  { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * reach + size * 0.08] }) },
                  { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(i % 2 ? 1 : -1) * 220}deg`] }) },
                ],
              }} />
            );
          })}
        </>
      )}
      <Pop>{children}</Pop>
    </Animated.View>
  );
}
