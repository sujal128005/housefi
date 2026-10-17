// Housefi illustrations: Housefi's own soft-3D illustration tiles (assets/illustrations, one rounded-square WebP each,
// cut from the generated sheets) for categories, services, steps, states and people, with an optional gentle float.
// The AI assistant (chat bubbles) and SOS (warning) use existing tiles as stopgaps. Two pictures have no
// illustration yet (technician offline, rating thumbs); they use the earlier code-drawn glossy tile (Material Design
// Icons, Apache 2.0) until their illustrations arrive. Adding one later is a single line in IMG below; screens do not
// change.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, type ComponentProps } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme/tokens';
import { useReducedMotion } from '../ui/motion';

type Glyph = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Palette = readonly [string, string];

/** Gradients, light to dark. Each service category has its own colour; the rest share a few brand families. */
const P = {
  violet: ['#3F94FF', '#0A3CF5'],
  indigo: ['#6FA8FF', '#1E52E8'],
  sky: ['#38D3FF', '#0088E6'],
  teal: ['#47E0D0', '#0A9C9A'],
  amber: ['#FFD54A', '#F59100'],
  orange: ['#FFB25C', '#F06A0A'],
  pink: ['#FF96B6', '#E5437A'],
  green: ['#62E39A', '#11995A'],
  red: ['#FF8A8F', '#DE3A40'],
  slate: ['#A7B0C8', '#56607E'],
  night: ['#4A7BFF', '#0626B5'],
  plum: ['#8EA0FF', '#4656EE'],
} as const satisfies Record<string, Palette>;

interface ArtSpec {
  readonly glyph: Glyph;
  readonly palette: Palette;
}

const a = (glyph: Glyph, palette: Palette): ArtSpec => ({ glyph, palette });

export const ART = {
  // service categories
  tap: a('faucet', P.sky),
  bulb: a('lightbulb-on', P.amber),
  snowflake: a('air-conditioner', P.teal),
  tv: a('washing-machine', P.plum),
  sponge: a('spray-bottle', P.pink),
  saw: a('hand-saw', P.orange),
  // things and places
  alarm: a('alarm', P.orange),
  bell: a('bell-ring', P.violet),
  broom: a('broom', P.pink),
  bubbles: a('chart-bubble', P.sky),
  bucket: a('bucket', P.sky),
  calendar: a('calendar-check', P.violet),
  call: a('phone-in-talk', P.green),
  camera: a('camera', P.indigo),
  card: a('credit-card', P.violet),
  chat: a('chat-processing', P.violet),
  check: a('check-bold', P.green),
  clipboard: a('clipboard-text', P.indigo),
  droplet: a('water', P.sky),
  envelope: a('email', P.violet),
  gear: a('cog', P.slate),
  globe: a('earth', P.sky),
  hammer: a('hammer', P.orange),
  handshake: a('handshake', P.green),
  hourglass: a('timer-sand', P.amber),
  house: a('home', P.violet),
  house_garden: a('home-heart', P.violet),
  key: a('key-variant', P.amber),
  locked: a('lock', P.night),
  magnifier: a('magnify', P.indigo),
  memo: a('note-text', P.amber),
  mic: a('microphone', P.pink),
  money: a('cash-multiple', P.green),
  moon: a('weather-night', P.night),
  package: a('package-variant-closed', P.slate),
  party: a('party-popper', P.pink),
  phone: a('cellphone', P.violet),
  pin: a('map-marker', P.red),
  plug: a('power-plug', P.amber),
  receipt: a('receipt-text', P.indigo),
  robot: a('robot-happy', P.violet),
  rocket: a('rocket-launch', P.orange),
  scooter: a('moped', P.violet),
  screwdriver: a('screwdriver', P.orange),
  shield: a('shield-check', P.green),
  shower: a('shower-head', P.sky),
  soap: a('hand-wash', P.sky),
  sos: a('alarm-light', P.red),
  sparkles: a('star-four-points', P.amber),
  spiral_calendar: a('calendar-clock', P.indigo),
  star: a('star', P.amber),
  stopwatch: a('timer-outline', P.orange),
  sun: a('white-balance-sunny', P.amber),
  sun_cloud: a('weather-partly-cloudy', P.sky),
  tech_man: a('account-hard-hat', P.violet),
  tech_woman: a('account-hard-hat', P.pink),
  thumbs_up: a('thumb-up', P.green),
  toilet: a('toilet', P.sky),
  toolbox: a('toolbox', P.orange),
  tools: a('tools', P.indigo),
  voltage: a('lightning-bolt', P.amber),
  wave: a('hand-wave', P.amber),
  woman: a('face-woman', P.pink),
  world_map: a('map', P.teal),
  wrench: a('wrench', P.slate),
} as const satisfies Record<string, ArtSpec>;

/** The illustrations. Every name here wins over the code-drawn tile of the same name. */
const IMG = {
  alarm: require('../../assets/illustrations/alarm.webp'),
  bell: require('../../assets/illustrations/bell.webp'),
  bulb: require('../../assets/illustrations/bulb.webp'),
  calendar: require('../../assets/illustrations/calendar.webp'),
  call: require('../../assets/illustrations/call.webp'),
  camera: require('../../assets/illustrations/camera.webp'),
  card: require('../../assets/illustrations/card.webp'),
  card_failed: require('../../assets/illustrations/card_failed.webp'),
  cash: require('../../assets/illustrations/cash.webp'),
  check: require('../../assets/illustrations/check.webp'),
  clipboard: require('../../assets/illustrations/clipboard.webp'),
  customer: require('../../assets/illustrations/customer.webp'),
  earnings: require('../../assets/illustrations/earnings.webp'),
  finding: require('../../assets/illustrations/finding.webp'),
  globe: require('../../assets/illustrations/globe.webp'),
  handshake: require('../../assets/illustrations/handshake.webp'),
  hourglass: require('../../assets/illustrations/hourglass.webp'),
  house: require('../../assets/illustrations/house.webp'),
  house_garden: require('../../assets/illustrations/house_garden.webp'),
  inspecting: require('../../assets/illustrations/inspecting.webp'),
  job_offer: require('../../assets/illustrations/job_offer.webp'),
  key: require('../../assets/illustrations/key.webp'),
  magnifier: require('../../assets/illustrations/magnifier.webp'),
  memo: require('../../assets/illustrations/memo.webp'),
  mic: require('../../assets/illustrations/mic.webp'),
  money: require('../../assets/illustrations/money.webp'),
  no_results: require('../../assets/illustrations/no_results.webp'),
  package: require('../../assets/illustrations/package.webp'),
  party: require('../../assets/illustrations/party.webp'),
  pay_due: require('../../assets/illustrations/pay_due.webp'),
  pay_pending: require('../../assets/illustrations/pay_pending.webp'),
  pay_success: require('../../assets/illustrations/pay_success.webp'),
  pin: require('../../assets/illustrations/pin.webp'),
  receipt: require('../../assets/illustrations/receipt.webp'),
  refund: require('../../assets/illustrations/refund.webp'),
  robot: require('../../assets/illustrations/robot.webp'),
  rocket: require('../../assets/illustrations/rocket.webp'),
  saw: require('../../assets/illustrations/saw.webp'),
  scooter: require('../../assets/illustrations/scooter.webp'),
  shield: require('../../assets/illustrations/shield.webp'),
  sos: require('../../assets/illustrations/sos.webp'),
  snowflake: require('../../assets/illustrations/snowflake.webp'),
  spiral_calendar: require('../../assets/illustrations/spiral_calendar.webp'),
  sponge: require('../../assets/illustrations/sponge.webp'),
  star: require('../../assets/illustrations/star.webp'),
  start_code: require('../../assets/illustrations/start_code.webp'),
  svc_ac: require('../../assets/illustrations/svc_ac.webp'),
  svc_ac_repair: require('../../assets/illustrations/svc_ac_repair.webp'),
  svc_bath: require('../../assets/illustrations/svc_bath.webp'),
  svc_carpentry: require('../../assets/illustrations/svc_carpentry.webp'),
  svc_door: require('../../assets/illustrations/svc_door.webp'),
  svc_drain: require('../../assets/illustrations/svc_drain.webp'),
  svc_fan: require('../../assets/illustrations/svc_fan.webp'),
  svc_fridge: require('../../assets/illustrations/svc_fridge.webp'),
  svc_furniture: require('../../assets/illustrations/svc_furniture.webp'),
  svc_geyser: require('../../assets/illustrations/svc_geyser.webp'),
  svc_kitchen: require('../../assets/illustrations/svc_kitchen.webp'),
  svc_leak: require('../../assets/illustrations/svc_leak.webp'),
  svc_light: require('../../assets/illustrations/svc_light.webp'),
  svc_ro: require('../../assets/illustrations/svc_ro.webp'),
  svc_sofa: require('../../assets/illustrations/svc_sofa.webp'),
  svc_switch: require('../../assets/illustrations/svc_switch.webp'),
  svc_tank: require('../../assets/illustrations/svc_tank.webp'),
  svc_tap: require('../../assets/illustrations/svc_tap.webp'),
  svc_washer: require('../../assets/illustrations/svc_washer.webp'),
  svc_wiring: require('../../assets/illustrations/svc_wiring.webp'),
  tap: require('../../assets/illustrations/tap.webp'),
  tech_done: require('../../assets/illustrations/tech_done.webp'),
  tech_hero: require('../../assets/illustrations/tech_hero.webp'),
  tech_man: require('../../assets/illustrations/tech_man.webp'),
  tech_woman: require('../../assets/illustrations/tech_woman.webp'),
  toolbox: require('../../assets/illustrations/toolbox.webp'),
  tools: require('../../assets/illustrations/tools.webp'),
  trophy: require('../../assets/illustrations/trophy.webp'),
  tv: require('../../assets/illustrations/tv.webp'),
  verify_fix: require('../../assets/illustrations/verify_fix.webp'),
  verify_ok: require('../../assets/illustrations/verify_ok.webp'),
  verify_pending: require('../../assets/illustrations/verify_pending.webp'),
  wave: require('../../assets/illustrations/wave.webp'),
  woman: require('../../assets/illustrations/woman.webp'),
  world_map: require('../../assets/illustrations/world_map.webp'),
} as const satisfies Record<string, ImageSourcePropType>;

export type ArtName = keyof typeof ART | keyof typeof IMG;

/** Symbols for the small, functional size (under 32 pt), where a detailed illustration would turn to blur. */
const FLAT: Partial<Record<string, Glyph>> = {
  svc_tap: 'faucet', svc_leak: 'pipe-leak', svc_drain: 'pipe-wrench', svc_tank: 'water-pump', svc_fan: 'ceiling-fan',
  svc_switch: 'light-switch', svc_wiring: 'flash', svc_light: 'ceiling-light', svc_ac: 'air-conditioner', svc_ac_repair: 'air-conditioner',
  svc_fridge: 'fridge', svc_washer: 'washing-machine', svc_ro: 'water', svc_geyser: 'water-boiler', svc_kitchen: 'countertop',
  svc_bath: 'toilet', svc_sofa: 'sofa', svc_door: 'door', svc_furniture: 'wardrobe', svc_carpentry: 'hand-saw',
  customer: 'account', tech_hero: 'account-hard-hat', pay_success: 'check-circle', pay_pending: 'timer-sand', card_failed: 'credit-card-off',
  cash: 'cash', earnings: 'chart-line', pay_due: 'cash-clock', trophy: 'trophy', refund: 'cash-refund', verify_pending: 'timer-sand',
  verify_ok: 'shield-check', verify_fix: 'alert-circle', start_code: 'numeric', job_offer: 'bell-ring', finding: 'map-search',
  inspecting: 'magnify', no_results: 'magnify-close', tech_done: 'check-decagram',
};

/** Picture for one service (its own illustration), for lists and headers that show a specific service. */
const SERVICE_ART: Record<string, ArtName> = {
  'plumb-tap': 'svc_tap', 'plumb-leak': 'svc_leak', 'plumb-block': 'svc_drain', 'plumb-tank': 'svc_tank',
  'elec-fan': 'svc_fan', 'elec-switch': 'svc_switch', 'elec-wiring': 'svc_wiring', 'elec-light': 'svc_light',
  'ac-service': 'svc_ac', 'ac-repair': 'svc_ac_repair', 'ac-install': 'svc_ac',
  'app-washer': 'svc_washer', 'app-fridge': 'svc_fridge', 'app-ro': 'svc_ro', 'app-geyser': 'svc_geyser',
  'clean-bath': 'svc_bath', 'clean-kitchen': 'svc_kitchen', 'clean-sofa': 'svc_sofa',
  'carp-door': 'svc_door', 'carp-furniture': 'svc_furniture', 'carp-install': 'svc_carpentry',
};

export function serviceArt(serviceId: string | undefined, fallback: ArtName): ArtName {
  return (serviceId && SERVICE_ART[serviceId]) || fallback;
}

export interface Art3DProps {
  readonly name: ArtName;
  readonly size?: number;
  /** Gentle up-and-down float (skipped when the phone asks for reduced motion). */
  readonly float?: boolean;
  /** Soft shadow on the "ground" below the tile. */
  readonly shadow?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  /** Small second tile in the bottom-right corner (e.g. a check on a calendar). */
  readonly badge?: ArtName;
}

/** One glossy tile. */
function Tile({ spec, size }: { readonly spec: ArtSpec; readonly size: number }) {
  const r = size * 0.3;
  const [light, dark] = spec.palette;
  return (
    <View style={[{ width: size, height: size, borderRadius: r }, styles.tileShadow, {
      shadowColor: dark, shadowRadius: size * 0.16, shadowOffset: { width: 0, height: size * 0.09 }, elevation: Math.min(14, Math.round(size / 9)),
    }]}>
      <LinearGradient colors={[light, dark]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: r }]} />
      {/* gloss on the upper half, and a thin light rim */}
      <LinearGradient colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
        style={{ position: 'absolute', left: size * 0.06, right: size * 0.06, top: size * 0.04, height: size * 0.5, borderRadius: r * 0.85 }} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: r, borderWidth: Math.max(1, size * 0.012), borderColor: 'rgba(255,255,255,0.35)' }]} />
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <MaterialCommunityIcons name={spec.glyph} size={size * 0.54} color="#FFFFFF"
          style={Platform.OS === 'android' ? undefined : { textShadowColor: 'rgba(0,0,0,0.18)', textShadowOffset: { width: 0, height: size * 0.02 }, textShadowRadius: size * 0.04 }} />
      </View>
    </View>
  );
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
  const img = (IMG as Record<string, ImageSourcePropType>)[name];
  const spec = (ART as Record<string, ArtSpec>)[name] ?? ART.sparkles;
  if (size < 32) {
    // Functional size: a simple symbol in a soft chip, not a shrunken illustration.
    return (
      <View style={[styles.flat, { width: size, height: size, borderRadius: size * 0.3 }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <MaterialCommunityIcons name={FLAT[name] ?? spec.glyph} size={Math.round(size * 0.62)} color={colors.navy} />
      </View>
    );
  }
  // Tiles sit a little inside the requested box so the glow and shadow have room.
  const tile = Math.round(size * (img ? 0.9 : 0.78));
  const lift = v.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.06] });
  const shadowScale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] });
  const badgeSpec = badge && !img ? (ART as Record<string, ArtSpec>)[badge] : undefined;
  return (
    <View style={[{ width: size, alignItems: 'center' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {size >= 80 && !img ? <View style={[styles.glow, { width: size * 1.05, height: size * 1.05, borderRadius: size, backgroundColor: spec.palette[0] }]} /> : null}
        <Animated.View style={{ transform: [{ translateY: lift }] }}>
          {img ? (
            // The illustration already carries its pastel tile; a soft shadow lifts it off the page.
            <View style={[styles.imgTile, { width: tile, height: tile, borderRadius: tile * 0.24, shadowRadius: tile * 0.1, shadowOffset: { width: 0, height: tile * 0.06 }, elevation: Math.min(10, Math.round(tile / 12)) }]}>
              <Image source={img} style={{ width: tile, height: tile, borderRadius: tile * 0.24 }} resizeMode="cover" />
            </View>
          ) : <Tile spec={spec} size={tile} />}
          {badgeSpec ? (
            <View style={[styles.badge, { right: -tile * 0.16, bottom: -tile * 0.16 }]}>
              <Tile spec={badgeSpec} size={Math.round(tile * 0.46)} />
            </View>
          ) : null}
        </Animated.View>
      </View>
      {shadow ? (
        <Animated.View style={[styles.shadow, { width: tile * 0.7, height: Math.max(6, size * 0.07), borderRadius: size, transform: [{ scaleX: shadowScale }] }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  tileShadow: { shadowOpacity: 0.35 },
  glow: { position: 'absolute', opacity: 0.16 },
  badge: { position: 'absolute' },
  flat: { backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  imgTile: { backgroundColor: '#FFFFFF', shadowColor: '#0A2A8F', shadowOpacity: 0.16 },
  shadow: { backgroundColor: 'rgba(42, 28, 174, 0.12)', marginTop: -2 },
});
