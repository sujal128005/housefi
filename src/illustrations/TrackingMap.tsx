// Animated demo map for live tracking: a stylised neighbourhood, the route, the home pin and the technician moving
// along the route by `progress` (0 = shop, 1 = your door). No map provider or API key; real maps plug in later.
import { useEffect, useId, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors, radius } from '../theme/tokens';
import { useReducedMotion } from '../ui/motion';
import { Art3D } from './Art3D';
import { decorative } from './parts';

const W = 340;
const H = 220;
/** Route as points (x, y) in the 340 x 220 drawing. */
const ROUTE: readonly (readonly [number, number])[] = [[34, 186], [34, 132], [118, 132], [118, 76], [214, 76], [214, 48], [300, 48]];

function pointAt(progress: number): [number, number] {
  const segs = ROUTE.slice(1).map((p, i) => {
    const a = ROUTE[i] as readonly [number, number];
    return { a, b: p, len: Math.hypot(p[0] - a[0], p[1] - a[1]) };
  });
  const total = segs.reduce((s, x) => s + x.len, 0);
  let d = Math.max(0, Math.min(1, progress)) * total;
  for (const s of segs) {
    if (d <= s.len) return [s.a[0] + ((s.b[0] - s.a[0]) * d) / s.len, s.a[1] + ((s.b[1] - s.a[1]) * d) / s.len];
    d -= s.len;
  }
  const last = ROUTE[ROUTE.length - 1] as readonly [number, number];
  return [last[0], last[1]];
}

export function TrackingMap({ progress, width }: { readonly progress: number; readonly width: number }) {
  const u = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduce = useReducedMotion();
  const scale = width / W;
  const height = H * scale;
  const pos = useRef(new Animated.ValueXY({ x: pointAt(progress)[0], y: pointAt(progress)[1] })).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const [x, y] = pointAt(progress);
    Animated.timing(pos, { toValue: { x, y }, duration: reduce ? 0 : 900, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start();
  }, [progress, pos, reduce]);

  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [bob, reduce]);

  const done = pointAt(progress);
  const routePath = ROUTE.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ');
  const bike = 54 * scale;
  return (
    <View style={[styles.wrap, { width, height }]}>
      <Svg width={width} height={height} viewBox={`0 0 ${W} ${H}`} {...decorative}>
        <Defs>
          <LinearGradient id={`land${u}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#E9F7EF" /><Stop offset="1" stopColor="#E3EEFF" /></LinearGradient>
        </Defs>
        <Rect width={W} height={H} fill={`url(#land${u})`} />
        {/* blocks and parks */}
        <Rect x={54} y={150} width={56} height={44} rx={10} fill="#D8EFE2" />
        <Rect x={136} y={96} width={64} height={40} rx={10} fill="#FFFFFF" opacity={0.85} />
        <Rect x={232} y={92} width={84} height={52} rx={10} fill="#FDEBD8" />
        <Rect x={54} y={18} width={140} height={40} rx={10} fill="#FFFFFF" opacity={0.85} />
        <Rect x={136} y={160} width={180} height={40} rx={10} fill="#E3ECFF" />
        <Circle cx={78} cy={92} r={18} fill="#CBEBD6" />
        {/* streets */}
        <Path d="M0 132 H340 M0 76 H340 M118 0 V220 M214 0 V220 M34 0 V220 M300 0 V220" stroke="#FFFFFF" strokeWidth={14} />
        {/* route: travelled part dims */}
        <Path d={routePath} stroke="#B7C8F4" strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d={routePath} stroke={colors.blue} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 12" />
        <Circle cx={done[0]} cy={done[1]} r={5} fill={colors.blue} opacity={0.35} />
      </Svg>
      {/* home pin */}
      <View style={[styles.abs, { left: (300 - 23) * scale, top: (48 - 40) * scale }]}><Art3D name="house" size={46 * scale} /></View>
      {/* technician */}
      <Animated.View style={[styles.abs, {
        left: Animated.subtract(Animated.multiply(pos.x, scale), bike / 2),
        top: Animated.subtract(Animated.multiply(pos.y, scale), bike * 0.85),
      }]}>
        <Animated.View style={{ transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }] }}>
          <Art3D name="scooter" size={bike} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  abs: { position: 'absolute' },
});
