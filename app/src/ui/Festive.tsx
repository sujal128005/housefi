// Home screen extras: the festive greeting card (shown only while the server has a festival for today) and the Housefi
// sign-off at the very bottom of the home screens.
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import type { Greeting } from '../domain/types';
import { FestiveArt, festiveLook } from '../illustrations/FestiveArt';
import { useI18n } from '../i18n/I18n';
import { colors, radius, shadow, space } from '../theme/tokens';
import { Icon } from './Icon';
import { Tap } from './Tap';
import { Txt } from './Txt';
import { Appear } from './motion';

/** "Happy Diwali, Sujal": the festival's colours and drawing, a line for customers or technicians, and a service to book. */
export function FestiveCard({ greeting, name, audience, onBook }: {
  readonly greeting: Greeting;
  readonly name: string;
  readonly audience: 'customer' | 'technician';
  /** Customers only: opens the festival's service (greeting.categoryId). */
  readonly onBook?: () => void;
}) {
  const { l } = useI18n();
  const look = festiveLook(greeting.theme);
  const title = name ? `${l(greeting.title)}, ${name}` : l(greeting.title);
  const cta = audience === 'customer' && greeting.cta && onBook ? l(greeting.cta) : null;
  return (
    <Appear>
      <LinearGradient colors={look.card} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card} testID="home-festive">
        <View style={[styles.halo, { backgroundColor: look.accent }]} />
        <View style={styles.text}>
          <Txt variant="title3" style={{ color: look.ink }} testID="home-festive-title">{title}</Txt>
          <Txt variant="footnote" style={{ color: look.inkMuted }}>{l(audience === 'customer' ? greeting.body : greeting.techBody)}</Txt>
          {cta ? (
            <Tap onPress={onBook} style={[styles.cta, { backgroundColor: look.accent }]} accessibilityRole="button" accessibilityLabel={cta} testID="home-festive-book" haptic>
              <Txt variant="label" style={styles.ctaInk} numberOfLines={1}>{cta}</Txt>
              <Icon name="arrow-forward" size={16} color="ink" />
            </Tap>
          ) : null}
        </View>
        <View style={styles.art}><FestiveArt theme={greeting.theme} size={112} /></View>
      </LinearGradient>
    </Appear>
  );
}

/** The last thing on the home screen, like a signature: big quiet words, then where Housefi is made. */
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
  card: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 132, paddingVertical: space.lg, paddingLeft: space.lg, paddingRight: space.sm, borderRadius: radius.xxl, overflow: 'hidden', ...shadow.raised },
  halo: { position: 'absolute', width: 180, height: 180, borderRadius: 90, right: -50, top: -60, opacity: 0.16 },
  text: { flex: 1, gap: space.xs },
  art: { width: 112, alignItems: 'center', justifyContent: 'center' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, marginTop: space.xs },
  ctaInk: { color: colors.ink, flexShrink: 1 },
  sign: { gap: space.sm, paddingTop: space.x3, paddingBottom: space.lg },
  signBig: { color: colors.lineStrong, fontSize: 38, lineHeight: 46 },
  signRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  brand: { color: colors.inkSubtle, letterSpacing: 0.4 },
  signDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.inkSubtle },
});
