// Looping 3D animations for the live moments: finding a technician, assigned, on the way, at the door, repair in
// progress, job done, a job offer ringing. Each is a sprite sheet rendered by tools/icons3d (same models and light as
// the 3D icons) and played on the native thread by stepping through its frames, so it stays smooth while the screen
// works. With "reduce motion" on, the still frame shows instead.
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '../ui/motion';
import { ANIM_SHEETS } from './anim3dSheets';

export type AnimName = keyof typeof ANIM_SHEETS;

/** Same scale as the free-floating 3D icons (Art3D), so animations and icons line up. */
const SCALE = 1.24;

export interface Anim3DProps {
  readonly name: AnimName;
  readonly size: number;
  /** Plays this many times and then rests on the last frame; loops for ever when left out. */
  readonly loops?: number;
  /** The soft brand disc behind it, as behind the large 3D icons. */
  readonly stage?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function Anim3D({ name, size, loops, stage = true, style, testID }: Anim3DProps) {
  const sheet = ANIM_SHEETS[name];
  const reduce = useReducedMotion();
  const frame = useRef(new Animated.Value(0)).current;
  const cell = size * SCALE;
  const rows = Math.ceil(sheet.frames / sheet.cols);

  useEffect(() => {
    // Reduced motion: rest on the final frame (a finished, calm pose).
    if (reduce) {
      frame.setValue(sheet.frames - 1);
      return;
    }
    frame.setValue(0);
    const once = Animated.timing(frame, { toValue: sheet.frames, duration: (sheet.frames / sheet.fps) * 1000, easing: Easing.linear, useNativeDriver: true });
    const run = loops === undefined ? Animated.loop(once) : Animated.loop(once, { iterations: loops });
    run.start(({ finished }) => {
      if (finished && loops !== undefined) frame.setValue(sheet.frames - 1);
    });
    return () => run.stop();
  }, [frame, sheet, loops, reduce]);

  // Frame k shows while the value is in [k, k + 1): steps, not a slide between frames.
  const { x, y } = useMemo(() => {
    const input: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = 0; k < sheet.frames; k++) {
      const cx = -(k % sheet.cols) * cell;
      const cy = -Math.floor(k / sheet.cols) * cell;
      input.push(k, k + 0.999);
      xs.push(cx, cx);
      ys.push(cy, cy);
    }
    return {
      x: frame.interpolate({ inputRange: input, outputRange: xs, extrapolate: 'clamp' }),
      y: frame.interpolate({ inputRange: input, outputRange: ys, extrapolate: 'clamp' }),
    };
  }, [frame, sheet, cell]);

  return (
    <View style={[{ width: size, height: size }, styles.center, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={testID}>
      {stage ? <View style={[styles.stage, { width: size * 0.92, height: size * 0.92, borderRadius: size }]} /> : null}
      <View style={{ width: cell, height: cell, overflow: 'hidden' }}>
        <Animated.Image source={sheet.source} fadeDuration={0}
          style={{ width: cell * sheet.cols, height: cell * rows, transform: [{ translateX: x }, { translateY: y }] }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  stage: { position: 'absolute', backgroundColor: 'rgba(36, 85, 245, 0.09)' },
});
