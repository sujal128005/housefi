// 3D artwork: Microsoft Fluent Emoji 3D renders (MIT licence, assets/3d/LICENSE-fluentui-emoji.txt), shown with a
// soft ground shadow and an optional gentle float so screens feel alive. One registry, so the art can be swapped for
// custom renders later without touching screens.
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '../ui/motion';

export const ART = {
  alarm: require('../../assets/3d/alarm.png'),
  bell: require('../../assets/3d/bell.png'),
  broom: require('../../assets/3d/broom.png'),
  bubbles: require('../../assets/3d/bubbles.png'),
  bucket: require('../../assets/3d/bucket.png'),
  bulb: require('../../assets/3d/bulb.png'),
  calendar: require('../../assets/3d/calendar.png'),
  call: require('../../assets/3d/call.png'),
  camera: require('../../assets/3d/camera.png'),
  card: require('../../assets/3d/card.png'),
  chat: require('../../assets/3d/chat.png'),
  check: require('../../assets/3d/check.png'),
  clipboard: require('../../assets/3d/clipboard.png'),
  droplet: require('../../assets/3d/droplet.png'),
  envelope: require('../../assets/3d/envelope.png'),
  gear: require('../../assets/3d/gear.png'),
  globe: require('../../assets/3d/globe.png'),
  hammer: require('../../assets/3d/hammer.png'),
  handshake: require('../../assets/3d/handshake.png'),
  hourglass: require('../../assets/3d/hourglass.png'),
  house: require('../../assets/3d/house.png'),
  house_garden: require('../../assets/3d/house_garden.png'),
  key: require('../../assets/3d/key.png'),
  locked: require('../../assets/3d/locked.png'),
  magnifier: require('../../assets/3d/magnifier.png'),
  memo: require('../../assets/3d/memo.png'),
  mic: require('../../assets/3d/mic.png'),
  money: require('../../assets/3d/money.png'),
  moon: require('../../assets/3d/moon.png'),
  package: require('../../assets/3d/package.png'),
  party: require('../../assets/3d/party.png'),
  phone: require('../../assets/3d/phone.png'),
  pin: require('../../assets/3d/pin.png'),
  plug: require('../../assets/3d/plug.png'),
  receipt: require('../../assets/3d/receipt.png'),
  robot: require('../../assets/3d/robot.png'),
  rocket: require('../../assets/3d/rocket.png'),
  saw: require('../../assets/3d/saw.png'),
  scooter: require('../../assets/3d/scooter.png'),
  screwdriver: require('../../assets/3d/screwdriver.png'),
  shield: require('../../assets/3d/shield.png'),
  shower: require('../../assets/3d/shower.png'),
  snowflake: require('../../assets/3d/snowflake.png'),
  soap: require('../../assets/3d/soap.png'),
  sos: require('../../assets/3d/sos.png'),
  sparkles: require('../../assets/3d/sparkles.png'),
  spiral_calendar: require('../../assets/3d/spiral_calendar.png'),
  sponge: require('../../assets/3d/sponge.png'),
  star: require('../../assets/3d/star.png'),
  stopwatch: require('../../assets/3d/stopwatch.png'),
  sun: require('../../assets/3d/sun.png'),
  sun_cloud: require('../../assets/3d/sun_cloud.png'),
  tap: require('../../assets/3d/tap.png'),
  tech_man: require('../../assets/3d/tech_man.png'),
  tech_woman: require('../../assets/3d/tech_woman.png'),
  thumbs_up: require('../../assets/3d/thumbs_up.png'),
  toilet: require('../../assets/3d/toilet.png'),
  toolbox: require('../../assets/3d/toolbox.png'),
  tools: require('../../assets/3d/tools.png'),
  tv: require('../../assets/3d/tv.png'),
  voltage: require('../../assets/3d/voltage.png'),
  wave: require('../../assets/3d/wave.png'),
  woman: require('../../assets/3d/woman.png'),
  world_map: require('../../assets/3d/world_map.png'),
  wrench: require('../../assets/3d/wrench.png'),
} as const;

export type ArtName = keyof typeof ART;

export interface Art3DProps {
  readonly name: ArtName;
  readonly size?: number;
  /** Gentle up-and-down float (skipped when the phone asks for reduced motion). */
  readonly float?: boolean;
  /** Soft shadow on the "ground" below the object. */
  readonly shadow?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  /** Small second object in the bottom-right corner (e.g. a check on a calendar). */
  readonly badge?: ArtName;
}

export function Art3D({ name, size = 96, float = false, shadow = false, style, badge }: Art3DProps) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!float || reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [float, reduce, v]);
  const lift = v.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.06] });
  const shadowScale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] });
  return (
    <View style={[{ width: size, alignItems: 'center' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={{ transform: [{ translateY: lift }] }}>
        <Image source={ART[name]} style={{ width: size, height: size }} resizeMode="contain" />
        {badge ? <Image source={ART[badge]} style={[styles.badge, { width: size * 0.42, height: size * 0.42 }]} resizeMode="contain" /> : null}
      </Animated.View>
      {shadow ? (
        <Animated.View style={[styles.shadow, { width: size * 0.62, height: Math.max(6, size * 0.07), borderRadius: size, transform: [{ scaleX: shadowScale }] }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', right: -4, bottom: -4 },
  shadow: { backgroundColor: 'rgba(27, 42, 107, 0.12)', marginTop: 2 },
});
