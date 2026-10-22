// Housefi illustrations: the Housefi 3D icon set (assets/icons3d, one transparent 512 px WebP per name), rendered from
// three.js models in the same style, palette and lighting as the Housefi website (generator: tools/icons3d). Large
// pictures (96 pt and up) float freely with their own soft shadow; smaller ones sit on a soft brand tile so grids and
// rows stay tidy; under 32 pt a simple symbol stands in. Names without a 3D icon fall back to the code-drawn glossy
// tile (Material Design Icons, Apache 2.0). Adding an icon: model it in tools/icons3d, render, add one line to ICONS.
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

/** The 3D icons. Every name here wins over the code-drawn tile of the same name. */
const ICONS = {
  alarm: require('../../assets/icons3d/alarm.webp'),
  bell: require('../../assets/icons3d/bell.webp'),
  bulb: require('../../assets/icons3d/bulb.webp'),
  calendar: require('../../assets/icons3d/calendar.webp'),
  call: require('../../assets/icons3d/call.webp'),
  camera: require('../../assets/icons3d/camera.webp'),
  card: require('../../assets/icons3d/card.webp'),
  card_failed: require('../../assets/icons3d/card_failed.webp'),
  cash: require('../../assets/icons3d/cash.webp'),
  check: require('../../assets/icons3d/check.webp'),
  clipboard: require('../../assets/icons3d/clipboard.webp'),
  customer: require('../../assets/icons3d/customer.webp'),
  diya: require('../../assets/icons3d/diya.webp'),
  earnings: require('../../assets/icons3d/earnings.webp'),
  finding: require('../../assets/icons3d/finding.webp'),
  globe: require('../../assets/icons3d/globe.webp'),
  handshake: require('../../assets/icons3d/handshake.webp'),
  hourglass: require('../../assets/icons3d/hourglass.webp'),
  house: require('../../assets/icons3d/house.webp'),
  house_garden: require('../../assets/icons3d/house_garden.webp'),
  gift: require('../../assets/icons3d/gift.webp'),
  inspecting: require('../../assets/icons3d/inspecting.webp'),
  job_offer: require('../../assets/icons3d/job_offer.webp'),
  key: require('../../assets/icons3d/key.webp'),
  magnifier: require('../../assets/icons3d/magnifier.webp'),
  memo: require('../../assets/icons3d/memo.webp'),
  mic: require('../../assets/icons3d/mic.webp'),
  money: require('../../assets/icons3d/money.webp'),
  moon: require('../../assets/icons3d/moon.webp'),
  no_results: require('../../assets/icons3d/no_results.webp'),
  package: require('../../assets/icons3d/package.webp'),
  party: require('../../assets/icons3d/party.webp'),
  pay_due: require('../../assets/icons3d/pay_due.webp'),
  pay_pending: require('../../assets/icons3d/pay_pending.webp'),
  pay_success: require('../../assets/icons3d/pay_success.webp'),
  pin: require('../../assets/icons3d/pin.webp'),
  plug: require('../../assets/icons3d/plug.webp'),
  receipt: require('../../assets/icons3d/receipt.webp'),
  refund: require('../../assets/icons3d/refund.webp'),
  robot: require('../../assets/icons3d/robot.webp'),
  rocket: require('../../assets/icons3d/rocket.webp'),
  saw: require('../../assets/icons3d/saw.webp'),
  scooter: require('../../assets/icons3d/scooter.webp'),
  shield: require('../../assets/icons3d/shield.webp'),
  snowflake: require('../../assets/icons3d/snowflake.webp'),
  sos: require('../../assets/icons3d/sos.webp'),
  sparkles: require('../../assets/icons3d/sparkles.webp'),
  spiral_calendar: require('../../assets/icons3d/spiral_calendar.webp'),
  sponge: require('../../assets/icons3d/sponge.webp'),
  star: require('../../assets/icons3d/star.webp'),
  start_code: require('../../assets/icons3d/start_code.webp'),
  sun: require('../../assets/icons3d/sun.webp'),
  sun_cloud: require('../../assets/icons3d/sun_cloud.webp'),
  svc_ac: require('../../assets/icons3d/svc_ac.webp'),
  svc_ac_repair: require('../../assets/icons3d/svc_ac_repair.webp'),
  svc_bath: require('../../assets/icons3d/svc_bath.webp'),
  svc_carpentry: require('../../assets/icons3d/svc_carpentry.webp'),
  svc_door: require('../../assets/icons3d/svc_door.webp'),
  svc_drain: require('../../assets/icons3d/svc_drain.webp'),
  svc_fan: require('../../assets/icons3d/svc_fan.webp'),
  svc_fridge: require('../../assets/icons3d/svc_fridge.webp'),
  svc_furniture: require('../../assets/icons3d/svc_furniture.webp'),
  svc_geyser: require('../../assets/icons3d/svc_geyser.webp'),
  svc_kitchen: require('../../assets/icons3d/svc_kitchen.webp'),
  svc_leak: require('../../assets/icons3d/svc_leak.webp'),
  svc_light: require('../../assets/icons3d/svc_light.webp'),
  svc_ro: require('../../assets/icons3d/svc_ro.webp'),
  svc_sofa: require('../../assets/icons3d/svc_sofa.webp'),
  svc_switch: require('../../assets/icons3d/svc_switch.webp'),
  svc_tank: require('../../assets/icons3d/svc_tank.webp'),
  svc_tap: require('../../assets/icons3d/svc_tap.webp'),
  svc_washer: require('../../assets/icons3d/svc_washer.webp'),
  svc_wiring: require('../../assets/icons3d/svc_wiring.webp'),
  tap: require('../../assets/icons3d/tap.webp'),
  tech_done: require('../../assets/icons3d/tech_done.webp'),
  tech_hero: require('../../assets/icons3d/tech_hero.webp'),
  tech_man: require('../../assets/icons3d/tech_man.webp'),
  tech_woman: require('../../assets/icons3d/tech_woman.webp'),
  thumbs_up: require('../../assets/icons3d/thumbs_up.webp'),
  toilet: require('../../assets/icons3d/toilet.webp'),
  toolbox: require('../../assets/icons3d/toolbox.webp'),
  tools: require('../../assets/icons3d/tools.webp'),
  trophy: require('../../assets/icons3d/trophy.webp'),
  tv: require('../../assets/icons3d/tv.webp'),
  verify_fix: require('../../assets/icons3d/verify_fix.webp'),
  verify_ok: require('../../assets/icons3d/verify_ok.webp'),
  verify_pending: require('../../assets/icons3d/verify_pending.webp'),
  wave: require('../../assets/icons3d/wave.webp'),
  woman: require('../../assets/icons3d/woman.webp'),
  world_map: require('../../assets/icons3d/world_map.webp'),
} as const satisfies Record<string, ImageSourcePropType>;

export type ArtName = keyof typeof ART | keyof typeof ICONS;

/** Names that have a 3D picture. */
export type Art3DIconName = keyof typeof ICONS;

/** The bare 3D picture (no tile, no stage), for artwork that sits straight on a coloured background. */
export function art3dImage(name: Art3DIconName): ImageSourcePropType {
  return ICONS[name];
}

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
  const icon = (ICONS as Record<string, ImageSourcePropType>)[name];
  const spec = (ART as Record<string, ArtSpec>)[name] ?? ART.sparkles;
  if (size < 32) {
    // Functional size: a simple symbol in a soft chip, not a shrunken illustration.
    return (
      <View style={[styles.flat, { width: size, height: size, borderRadius: size * 0.3 }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <MaterialCommunityIcons name={FLAT[name] ?? spec.glyph} size={Math.round(size * 0.62)} color={colors.navy} />
      </View>
    );
  }
  const lift = v.interpolate({ inputRange: [0, 1], outputRange: [0, -size * (icon ? 0.04 : 0.06)] });
  if (icon && size >= FREE_FROM) {
    // Hero size: the 3D object floats on the page with its own soft contact shadow (as on the website).
    return (
      <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {/* A soft brand-blue disc gives the floating object a stage (pale on light pages, a gentle glow on cobalt). */}
        <View style={[styles.stage, { width: size * 0.92, height: size * 0.92, borderRadius: size }]} />
        <Animated.View style={{ transform: [{ translateY: lift }] }}>
          {/* Drawn larger than the box: the render keeps margin for its shadow. */}
          <Image source={icon} style={{ width: size * FREE_SCALE, height: size * FREE_SCALE }} resizeMode="contain" />
        </Animated.View>
      </View>
    );
  }
  // Tiles sit a little inside the requested box so the glow and shadow have room.
  const tile = Math.round(size * (icon ? 0.9 : 0.78));
  const shadowScale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] });
  const badgeSpec = badge && !icon ? (ART as Record<string, ArtSpec>)[badge] : undefined;
  return (
    <View style={[{ width: size, alignItems: 'center' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {size >= 80 && !icon ? <View style={[styles.glow, { width: size * 1.05, height: size * 1.05, borderRadius: size, backgroundColor: spec.palette[0] }]} /> : null}
        <Animated.View style={{ transform: [{ translateY: lift }] }}>
          {icon ? <IconTile source={icon} size={tile} tint={TINTS[TINT_OF[name] ?? 'blue']} /> : <Tile spec={spec} size={tile} />}
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

/** From this size up, 3D icons float freely instead of sitting on a tile. */
const FREE_FROM = 96;
const FREE_SCALE = 1.24;

/** A 3D icon on the soft brand tile: white to the logo's pale blue, a light rim and a gentle shadow. */
function IconTile({ source, size, tint }: { readonly source: ImageSourcePropType; readonly size: number; readonly tint: string }) {
  const r = size * 0.28;
  return (
    <View style={[styles.iconTile, { width: size, height: size, borderRadius: r, shadowRadius: size * 0.12, shadowOffset: { width: 0, height: size * 0.07 }, elevation: Math.min(8, Math.round(size / 14)) }]}>
      <LinearGradient colors={['#FFFFFF', tint]} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: r }]} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: r, borderWidth: Math.max(1, size * 0.014), borderColor: 'rgba(255,255,255,0.9)' }]} />
      <Image source={source} style={{ width: size * 1.02, height: size * 1.02 }} resizeMode="contain" />
    </View>
  );
}

/** Tile tints (bottom-right of the tile), from the app's washes: one per category, and by meaning for states. */
const TINTS = {
  blue: '#DCE7FF', sky: '#D2EFFC', amber: '#FFE9C2', mint: '#D3F3E4', lavender: '#E3E3FF', peach: '#FFE0CC', sunrise: '#FFE6CC', rose: '#FFDADC',
} as const;

const TINT_OF: Partial<Record<string, keyof typeof TINTS>> = {
  // categories and their services
  tap: 'sky', svc_tap: 'sky', svc_leak: 'sky', svc_drain: 'sky', svc_tank: 'sky',
  bulb: 'amber', svc_fan: 'amber', svc_switch: 'amber', svc_wiring: 'amber', svc_light: 'amber', plug: 'amber',
  snowflake: 'mint', svc_ac: 'mint', svc_ac_repair: 'mint',
  tv: 'lavender', svc_washer: 'lavender', svc_fridge: 'lavender', svc_ro: 'lavender', svc_geyser: 'lavender',
  sponge: 'peach', svc_bath: 'peach', svc_kitchen: 'peach', svc_sofa: 'peach', toilet: 'peach',
  saw: 'sunrise', svc_door: 'sunrise', svc_furniture: 'sunrise', svc_carpentry: 'sunrise', tools: 'sunrise', toolbox: 'sunrise',
  // money
  cash: 'amber', money: 'amber', earnings: 'amber', pay_due: 'amber', pay_pending: 'amber', refund: 'amber', receipt: 'amber', trophy: 'amber', star: 'amber', sun: 'amber', sun_cloud: 'sky', key: 'amber',
  // states
  check: 'mint', pay_success: 'mint', verify_ok: 'mint', tech_done: 'mint', shield: 'mint', handshake: 'mint', party: 'mint',
  card_failed: 'rose', no_results: 'rose', sos: 'rose', verify_fix: 'peach', verify_pending: 'amber', hourglass: 'amber', alarm: 'peach',
  // people and places
  customer: 'peach', woman: 'sky', wave: 'amber', globe: 'sky', world_map: 'sky', pin: 'rose', moon: 'lavender',
};

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  tileShadow: { shadowOpacity: 0.35 },
  glow: { position: 'absolute', opacity: 0.16 },
  badge: { position: 'absolute' },
  flat: { backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  iconTile: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', shadowColor: '#0A2A8F', shadowOpacity: 0.14 },
  stage: { position: 'absolute', backgroundColor: 'rgba(36, 85, 245, 0.09)' },
  shadow: { backgroundColor: 'rgba(42, 28, 174, 0.12)', marginTop: -2 },
});
