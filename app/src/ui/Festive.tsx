// Home screen extras. On festival days (the server's calendar: catalog/greeting) the top of the home screen dresses up,
// the way super.money does for Diwali: the header wash takes the festival's colours with a dotted texture and sparkles
// (FestiveBackdrop), a soft glowing arch carries the festival's name, 3D gifts and a lamp, and a "Book now"
// (FestiveBanner), and the customer home shows the festival's coupon from Housefi HQ on a scalloped strip
// (FestiveStrip). Everything is drawn at the measured size, so nothing stretches. The Housefi sign-off closes both
// home screens every day.
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Path, Pattern, RadialGradient, Rect, Stop, LinearGradient as SvgGradient } from 'react-native-svg';
import type { FestiveCoupon, Greeting } from '../domain/types';
import { art3dImage } from '../illustrations/Art3D';
import { festiveLook } from '../illustrations/FestiveArt';
import { useI18n } from '../i18n/I18n';
import { feedback } from '../services/feedback';
import { colors, radius, shadow, space } from '../theme/tokens';
import { Icon } from './Icon';
import { useToast } from './Overlays';
import { Tap } from './Tap';
import { Txt } from './Txt';
import { Appear } from './motion';

/** A four-point sparkle, as an SVG path. */
const sparkle = (x: number, y: number, r: number) =>
  `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`;

/** The view's measured size (0 × 0 until it is laid out). */
function useSize() {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
  };
  return [size, onLayout] as const;
}

/** A fine dotted texture and a few sparkles over the header wash. */
export function FestiveBackdrop({ theme }: { readonly theme: string }) {
  const look = festiveLook(theme);
  const [{ w, h }, onLayout] = useSize();
  const stars: [number, number, number][] = [[0.08, 120, 5], [0.93, 58, 6], [0.62, 22, 4], [0.27, 26, 3.5], [0.97, 180, 4]];
  const dots: [number, number, number][] = [[0.14, 74, 2.2], [0.5, 40, 1.8], [0.83, 104, 2], [0.04, 200, 1.6]];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {w > 0 ? (
        <Svg width={w} height={h}>
          <Defs>
            <Pattern id="dots" x={0} y={0} width={13} height={13} patternUnits="userSpaceOnUse">
              <Circle cx={6.5} cy={6.5} r={1} fill="#FFFFFF" opacity={0.42} />
            </Pattern>
            <SvgGradient id="fade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </SvgGradient>
          </Defs>
          <Rect x={0} y={0} width={w} height={Math.min(h, 360)} fill="url(#dots)" />
          {dots.map(([fx, y, r]) => <Circle key={`d${fx}`} cx={fx * w} cy={y} r={r} fill={look.accent} opacity={0.85} />)}
          {stars.map(([fx, y, r]) => <Path key={`s${fx}`} d={sparkle(fx * w, y, r)} fill="#FFFFFF" opacity={0.9} />)}
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * The festival's name ("housefi" over "Happy Diwali") on a soft glowing arch that melts into the header, 3D art on
 * its left foot and, for customers, a "Book now" on the right.
 */
export function FestiveBanner({ greeting, onBook }: { readonly greeting: Greeting; readonly onBook?: () => void }) {
  const { t, l } = useI18n();
  const look = festiveLook(greeting.theme);
  const [{ w }, onLayout] = useSize();
  const H = 150;
  const r = Math.min(150, w * 0.4);
  const cx = w / 2;
  const cy = 20 + r;
  const below = 46;
  return (
    <Appear>
      <View style={[styles.banner, { height: H }]} onLayout={onLayout} testID="home-festive">
        {w > 0 ? (
          <Svg width={w} height={H + below} style={styles.arch} pointerEvents="none">
            <Defs>
              <RadialGradient id="halo" cx={cx} cy={cy} r={r + 22} gradientUnits="userSpaceOnUse">
                <Stop offset={r / (r + 22) - 0.02} stopColor="#FFFFFF" stopOpacity={0} />
                <Stop offset={r / (r + 22)} stopColor="#FFFFFF" stopOpacity={0.6} />
                <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
              </RadialGradient>
              <SvgGradient id="disc" x1="0" y1={cy - r} x2="0" y2={H + below} gradientUnits="userSpaceOnUse">
                <Stop offset={0} stopColor={look.dome[0]} stopOpacity={1} />
                <Stop offset={0.5} stopColor={look.dome[1]} stopOpacity={0.95} />
                <Stop offset={1} stopColor={look.dome[1]} stopOpacity={0} />
              </SvgGradient>
            </Defs>
            <Circle cx={cx} cy={cy} r={r + 22} fill="url(#halo)" />
            <Circle cx={cx} cy={cy} r={r} fill="url(#disc)" />
            <Path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`} stroke="#FFFFFF" strokeOpacity={0.9} strokeWidth={2} fill="none" />
            <Path d={sparkle(cx - r * 0.42, cy - r * 0.74, 6)} fill="#FFFFFF" />
            <Path d={sparkle(cx + r * 0.42, cy - r * 0.74, 6)} fill="#FFFFFF" />
            <Path d={sparkle(cx + r * 0.62, cy - r * 0.86, 4)} fill={look.accent} />
          </Svg>
        ) : null}
        <View style={[styles.title, { top: 20 + r * 0.28, left: cx - r * 0.78, width: r * 1.56 }]} pointerEvents="none">
          <Txt variant="caption" align="center" style={[styles.brandOn, { color: look.titleShadow }]}>housefi</Txt>
          <Txt variant="title1" align="center" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} testID="home-festive-title"
            style={[styles.festName, { color: look.title, textShadowColor: look.titleShadow }]}>{l(greeting.title)}</Txt>
        </View>
        <View style={[styles.artRow, { left: Math.max(0, cx - r - 34) }]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Image source={art3dImage(look.art[0])} style={styles.artBig} resizeMode="contain" />
          <Image source={art3dImage(look.art[1])} style={styles.artSmall} resizeMode="contain" />
        </View>
        {onBook ? (
          <Tap onPress={onBook} style={styles.cta} accessibilityRole="button" accessibilityLabel={t('festive.bookNow')} testID="home-festive-book" haptic>
            <Txt variant="caption" align="center" numberOfLines={2} style={[styles.ctaLabel, { color: look.deep }]}>{t('festive.bookNow')}</Txt>
            <View style={styles.ctaPill}><Icon name="arrow-forward" size={16} color="onLime" /></View>
          </Tap>
        ) : null}
      </View>
    </Appear>
  );
}

/** Scalloped edge, drawn at the measured width so every bump stays round. */
function Scallops({ width, colors: [a, b], flip }: { readonly width: number; readonly colors: readonly [string, string]; readonly flip?: boolean }) {
  if (width <= 0) return <View style={styles.scallopSpace} />;
  const n = Math.round(width / 12);
  const step = width / n;
  const d = `M0 7 ${Array.from({ length: n }, (_, i) => `Q${i * step + step / 2} -3 ${(i + 1) * step} 7`).join(' ')} L${width} 7Z`;
  const id = flip ? 'scallopB' : 'scallopT';
  return (
    <Svg width={width} height={7} style={flip ? styles.flip : undefined}>
      <Defs>
        <SvgGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={flip ? b : a} />
          <Stop offset="1" stopColor={flip ? a : b} />
        </SvgGradient>
      </Defs>
      <Path d={d} fill={`url(#${id})`} />
    </Svg>
  );
}

function offerLine(c: FestiveCoupon, t: ReturnType<typeof useI18n>['t']) {
  return c.kind === 'PERCENT' ? t('festive.offPercent', { n: c.value }) : t('festive.offFlat', { n: c.value });
}

/**
 * "GET 26% OFF · use code DIWALI26 · BOOK NOW": the festival's coupon from Housefi HQ, shown only while it can be
 * used. Tapping the code copies it; the rest opens the festival's service.
 */
export function FestiveStrip({ greeting, onBook, style }: { readonly greeting: Greeting; readonly onBook: () => void; readonly style?: StyleProp<ViewStyle> }) {
  const { t } = useI18n();
  const toast = useToast();
  const [{ w }, onLayout] = useSize();
  const c = greeting.coupon;
  if (!c) return null;
  const look = festiveLook(greeting.theme);
  const notes = [c.kind === 'PERCENT' && c.maxDiscount ? t('festive.upTo', { n: c.maxDiscount }) : null, c.firstBookingOnly ? t('festive.firstOnly') : null].filter(Boolean).join(' · ');
  const copy = async () => {
    await Clipboard.setStringAsync(c.code).catch(() => undefined);
    feedback('select');
    toast.show(t('festive.copied', { code: c.code }), 'copy');
  };
  return (
    <Appear style={style}>
      <View onLayout={onLayout} testID="home-festive-strip">
        <Scallops width={w} colors={look.strip} />
        <Tap onPress={onBook} scale={0.99} haptic accessibilityRole="button" accessibilityLabel={`${offerLine(c, t)}, ${t('festive.useCode')} ${c.code}. ${t('festive.bookNow')}`}>
          <View style={styles.strip}>
            <LinearGradient colors={look.strip} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            {w > 0 ? (
              <Svg width={w} height={78} style={styles.arch} pointerEvents="none">
                <Path d={sparkle(w * 0.6, 16, 5)} fill="#FFFFFF" />
                <Circle cx={w * 0.52} cy={66} r={2} fill={look.accent} />
              </Svg>
            ) : null}
            <View style={styles.offer}>
              <Txt variant="title2" numberOfLines={1} adjustsFontSizeToFit style={[styles.offerTitle, { color: look.deep }]} testID="home-festive-offer">{offerLine(c, t)}</Txt>
              <View style={styles.codeRow}>
                <Tap onPress={() => void copy()} style={[styles.ticket, { borderColor: look.button }]} accessibilityRole="button" accessibilityLabel={t('festive.copy', { code: c.code })} testID="home-festive-code">
                  <Txt variant="label" style={[styles.code, { color: look.button }]}>{c.code}</Txt>
                  <Icon name="copy-outline" size={14} color="inkMuted" />
                </Tap>
                <Txt variant="caption" color="inkMuted" numberOfLines={2} style={styles.flex}>{notes || t('festive.whenPay')}</Txt>
              </View>
            </View>
            <View style={[styles.book, { backgroundColor: look.button }]}>
              <Txt variant="caption" style={styles.bookInk} numberOfLines={1}>{t('festive.bookNow')}</Txt>
            </View>
          </View>
        </Tap>
        <Scallops width={w} colors={look.strip} flip />
      </View>
    </Appear>
  );
}

/** The last thing on the home screen, like a signature: big quiet words, then the maker's line. */
export function SignOff({ audience }: { readonly audience: 'customer' | 'technician' }) {
  const { t } = useI18n();
  return (
    <View style={styles.sign} testID="home-signoff" accessibilityRole="text">
      <Txt variant="hero" style={styles.signBig}>{t(audience === 'customer' ? 'signoff.customer' : 'signoff.tech')}</Txt>
      <View style={styles.signRow}>
        <Txt variant="label" style={styles.brand}>housefi</Txt>
        <View style={styles.signDot} />
        <Icon name="heart" size={13} color="pink" />
        <Txt variant="caption" color="inkSubtle">{t(audience === 'customer' ? 'signoff.made' : 'signoff.madeTech')}</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: { width: '100%' },
  arch: { position: 'absolute', left: 0, top: 0 },
  title: { position: 'absolute', alignItems: 'center' },
  brandOn: { letterSpacing: 2.5 },
  festName: { fontSize: 31, lineHeight: 37, textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 2 },
  artRow: { position: 'absolute', bottom: -10, flexDirection: 'row', alignItems: 'flex-end' },
  artBig: { width: 96, height: 96 },
  artSmall: { width: 66, height: 66, marginLeft: -40, marginBottom: -6 },
  cta: { position: 'absolute', right: 0, top: 52, width: 70, alignItems: 'center', gap: 6 },
  ctaLabel: { textTransform: 'uppercase', letterSpacing: 0.6 },
  ctaPill: { width: 54, height: 30, borderRadius: radius.pill, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  scallopSpace: { height: 7 },
  flip: { transform: [{ rotate: '180deg' }] },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 78, paddingHorizontal: 20, paddingVertical: space.sm, overflow: 'hidden' },
  offer: { flex: 1, gap: 6 },
  offerTitle: { textTransform: 'uppercase', fontSize: 24, lineHeight: 28, letterSpacing: -0.3 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30, paddingHorizontal: space.sm, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.85)' },
  code: { letterSpacing: 1 },
  book: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  bookInk: { color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 0.6 },
  sign: { gap: space.sm, paddingTop: space.x3, paddingBottom: space.lg },
  signBig: { color: colors.lineStrong, fontSize: 38, lineHeight: 46 },
  signRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  brand: { color: colors.inkSubtle, letterSpacing: 0.4 },
  signDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.inkSubtle },
});
