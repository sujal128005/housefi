// Technician identity, one design for both apps: the profile photo, the verification pill (only a genuine approval
// shows as Verified; the demo's simulated approval says so), and the digital Housefi Technician ID card used by
// "My Housefi ID" (technician) and "Technician ID" (customer of an assigned booking).
//
// The card is for viewing on screen only: no copy, share, save or print actions; text is not selectable; the screen
// turns on the operating system's capture protection (IdCardShield) and carries a live watermark.
import { LinearGradient } from 'expo-linear-gradient';
import {
  addScreenshotListener, allowScreenCaptureAsync, disableAppSwitcherProtectionAsync, enableAppSwitcherProtectionAsync, preventScreenCaptureAsync,
} from 'expo-screen-capture';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { AppState, Image, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Path } from 'react-native-svg';
import { categoryById } from '../data/catalog';
import { isDisplayablePhoto, isPickedPhoto, verificationLook, type VerificationLook } from '../domain/identity';
import type { Gender, TechIdCard, Verification } from '../domain/types';
import { Art3D } from '../illustrations/Art3D';
import { useI18n } from '../i18n/I18n';
import type { QueryState } from '../services/ServicesProvider';
import { BRAND_GRADIENT, colors, radius, shadow, space } from '../theme/tokens';
import { type IconName } from './Icon';
import { Header, Screen } from './Layout';
import { useToast } from './Overlays';
import { ErrorView } from './States';
import { ByNexara, LogoMark } from './Logo';
import { Pill, Skeleton, type PillTone } from './Surfaces';
import { Txt } from './Txt';

// ---------- photo ----------

/**
 * The technician's photo: the real photo, the demo's sample (an illustration), or, when there is no photo to show,
 * an illustration of a technician (never a stranger's picture).
 */
export function TechPhoto({ photo, gender, size, style, picked = false }: {
  readonly photo: string | null | undefined;
  readonly gender: Gender;
  readonly size: number;
  readonly style?: StyleProp<ViewStyle>;
  /** The technician's own photo just taken on this phone (profile setup); shown before it is uploaded. */
  readonly picked?: boolean;
}) {
  const r = size * 0.28;
  if (photo && (isDisplayablePhoto(photo) || (picked && isPickedPhoto(photo)))) {
    return (
      <View style={[styles.photoBox, { width: size, height: size, borderRadius: r }, style]}>
        <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: r }} resizeMode="cover" accessibilityIgnoresInvertColors />
      </View>
    );
  }
  // The demo's sample, or no usable photo: an illustration (never a stranger's picture, never an unsafe URI).
  const art = photo === 'demo:tech_woman' || (photo !== 'demo:tech_man' && gender === 'F') ? 'tech_woman' : 'tech_man';
  return <Art3D name={art} size={Math.round(size / 0.9)} style={[{ margin: -size * 0.055 }, style]} />;
}

// ---------- verification ----------

const LOOK: Record<VerificationLook, { tone: PillTone; icon: IconName }> = {
  VERIFIED: { tone: 'success', icon: 'shield-checkmark' },
  DEMO: { tone: 'demo', icon: 'flask' },
  PENDING: { tone: 'warning', icon: 'time' },
  NEEDS_CORRECTION: { tone: 'warning', icon: 'alert-circle' },
  REJECTED: { tone: 'danger', icon: 'close-circle' },
  SUSPENDED: { tone: 'danger', icon: 'ban' },
  UNKNOWN: { tone: 'neutral', icon: 'help-circle' },
};

/** Verification as a pill. The tick appears only for a genuine approval. */
export function VerificationPill({ state, simulated }: { readonly state: Verification | null | undefined; readonly simulated: boolean | null | undefined }) {
  const { t } = useI18n();
  const look = verificationLook(state, simulated);
  return <Pill label={t(`id.v.${look}`)} tone={LOOK[look].tone} icon={LOOK[look].icon} />;
}

// ---------- the card ----------

/** The digital Housefi Technician ID card. `viewer`: whose screen it is on (the technician's own, or a customer's). */
export function TechIdCardView({ card, viewer, onOpenVerification }: {
  readonly card: TechIdCard;
  readonly viewer: 'self' | 'customer';
  /** Demo only: opens the verification page the QR code points to. */
  readonly onOpenVerification?: () => void;
}) {
  const { t, l, locale } = useI18n();
  const look = verificationLook(card.verification, card.simulated);
  const skills = card.skills.map((k) => categoryById(k)).filter((c) => !!c).map((c) => l(c.name));
  // The link sits where the "My Housefi ID" row was on the previous screen: ignore a carried-over second tap.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setArmed(true), 700);
    return () => clearTimeout(id);
  }, []);
  return (
    <View style={[styles.card, noSelect]} testID="id-card" accessibilityLabel={`${t('id.codeLabel')} ${card.techCode.split('').join(' ')}`}>
      {/* brand header */}
      <LinearGradient colors={BRAND_GRADIENT} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
        <Svg width={180} height={120} viewBox="0 0 180 120" style={styles.arc} pointerEvents="none">
          <Path d="M20 120 A100 100 0 0 1 180 20" stroke="rgba(0,178,238,0.45)" strokeWidth={18} fill="none" />
          <Path d="M58 120 A64 64 0 0 1 180 58" stroke={colors.amber} strokeWidth={10} fill="none" opacity={0.9} />
        </Svg>
        <View style={styles.brandRow}>
          <View style={styles.markBox}><LogoMark size={30} /></View>
          <View>
            <Txt variant="title3" color="onNavy" lang="en">Housefi</Txt>
            <ByNexara size="caption" tone="onDark" />
          </View>
        </View>
        <Txt variant="caption" color="onNavyMuted" style={styles.caption}>{t('id.cardCaption')}</Txt>
      </LinearGradient>

      <Watermark code={card.techCode} />

      {/* photo and name */}
      <View style={styles.who}>
        <View style={styles.photoRing}>
          <TechPhoto photo={card.photo} gender={card.gender} size={104} />
        </View>
        <Txt variant="title2" align="center" testID="id-name" numberOfLines={2}>{card.name}</Txt>
        <Txt variant="callout" color="inkMuted" align="center">{t('id.role')}</Txt>
        {skills.length > 0 ? <Txt variant="footnote" color="inkMuted" align="center" numberOfLines={2}>{skills.join(' · ')}</Txt> : null}
        {card.fictional ? <Txt variant="caption" color="demo" align="center">{t('id.fictional')}</Txt> : null}
        {!card.fictional && card.photo?.startsWith('demo:') ? <Txt variant="caption" color="demo" align="center">{t('id.sample')}</Txt> : null}
        {viewer === 'self' && card.photoStatus !== 'APPROVED' ? <Pill label={t('id.photoPending')} tone="warning" icon="image" /> : null}
      </View>

      {/* permanent ID */}
      <View style={styles.idBlock}>
        <Txt variant="caption" color="inkMuted">{t('id.codeLabel')}</Txt>
        <Txt variant="title2" color="navy" style={styles.code} lang="en" testID="id-code">{card.techCode}</Txt>
      </View>

      {/* verification */}
      <View style={[styles.status, look === 'VERIFIED' ? styles.statusOk : look === 'DEMO' ? styles.statusDemo : look === 'PENDING' || look === 'NEEDS_CORRECTION' ? styles.statusWait : styles.statusBad]} testID={`id-status-${look}`}>
        <View style={styles.statusHead}>
          <Txt variant="caption" color="inkMuted" style={styles.flex}>{t('id.statusLabel')}</Txt>
          <VerificationPill state={card.verification} simulated={card.simulated} />
        </View>
        <Txt variant="footnote" color="ink">{t(`id.vb.${look}`)}</Txt>
      </View>

      {/* QR */}
      <View style={styles.qrRow}>
        <View style={styles.qrBox} accessibilityLabel={t('id.qr')} testID="id-qr">
          <QRCode value={card.verifyUrl} size={108} color={colors.ink} backgroundColor="#FFFFFF" ecl="M" quietZone={6} />
        </View>
        <View style={styles.flex}>
          <Txt variant="footnote" color="ink">{t('id.qr')}</Txt>
          {card.verifyIsDemo ? <Txt variant="caption" color="demo">{t('id.qrDemo')}</Txt> : null}
          {card.verifyIsDemo && onOpenVerification ? (
            <Txt variant="label" color="blue" onPress={() => armed && onOpenVerification()} accessibilityRole="link" testID="id-open-verify" style={styles.link}>{t('id.qrOpen')}</Txt>
          ) : null}
        </View>
      </View>
      <Txt variant="caption" color="inkSubtle" align="center" style={styles.foot} lang={locale}>{t('id.viewOnly')}</Txt>
    </View>
  );
}

/** A faint, live watermark (Housefi, the ID, the time it is being viewed) that discourages photos of the screen. */
function Watermark({ code }: { readonly code: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const stamp = `HOUSEFI · ${code} · ${now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  const rows = useMemo(() => Array.from({ length: 9 }, (_, i) => i), []);
  return (
    <View pointerEvents="none" style={styles.watermark} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {rows.map((i) => (
        <Txt key={i} variant="caption" color="navy" lang="en" numberOfLines={1} style={[styles.wmRow, { marginLeft: (i % 2) * -60 }]}>{`${stamp}   ${stamp}`}</Txt>
      ))}
    </View>
  );
}

// ---------- capture protection ----------

const CAPTURE_KEY = 'housefi-id-card';

/**
 * Wraps a screen that shows an ID card. Native protection while the card is on screen (switched off when another
 * screen covers it):
 * - Android: the window is marked secure (FLAG_SECURE): no screenshots or recordings, blank in recent apps. Verified
 *   on the emulator.
 * - iOS (16.4+, not yet tried on a device): a screenshot is still saved but the app area comes out blank (the window is
 *   drawn inside a secure text field, an undocumented iOS behaviour); while the screen is recorded or mirrored the card
 *   is covered in black, on the phone too; the app-switcher preview is blurred; after a screenshot the person is told.
 * Nothing stops someone photographing the phone with another camera.
 *
 * If switching protection on fails (iOS: the window is not attached yet), it is retried rather than silently skipped.
 */
export function IdCardShield({ children, onCaptureAttempt }: { readonly children: ReactNode; readonly onCaptureAttempt?: () => void }) {
  // One key per card screen: if one card screen's blur ever lands after another's focus, it releases only its own key
  // and the protection stays on for the card that is showing.
  const captureKey = `${CAPTURE_KEY}-${useId()}`;
  useFocusEffect(useCallback(() => {
    if (Platform.OS === 'web') return undefined;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const protect = (attempt: number) => {
      // Never switch protection on after the card has left the screen (nothing would switch it off again).
      if (!alive) return;
      preventScreenCaptureAsync(captureKey).catch((e: unknown) => {
        if (__DEV__) console.warn('ID card capture protection could not be switched on yet', e);
        // A failed attempt leaves nothing behind (the key is released), so trying again is safe. Only one retry is
        // pending at a time, so the cleanup below always cancels it.
        if (alive && attempt < 3) {
          if (retry) clearTimeout(retry);
          retry = setTimeout(() => protect(attempt + 1), 400);
        }
      });
    };
    protect(0);
    // Back from the background or a system sheet: make sure protection is on (a no-op when it already is).
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && alive) protect(0);
    });
    const ios = Platform.OS === 'ios';
    if (ios) void enableAppSwitcherProtectionAsync(0.9).catch(() => undefined);
    const sub = ios ? addScreenshotListener(() => onCaptureAttempt?.()) : null;
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      appState.remove();
      sub?.remove();
      if (ios) void disableAppSwitcherProtectionAsync().catch(() => undefined);
      void allowScreenCaptureAsync(captureKey).catch(() => undefined);
    };
  }, [captureKey, onCaptureAttempt]));
  return <View style={[styles.flex, noSelect]}>{children}</View>;
}

// ---------- the page ----------

/** A whole ID-card screen (technician's "My Housefi ID" and customer's "Technician ID"): loading, errors, protection. */
export function IdCardPage({ title, testID, query, viewer }: {
  readonly title: string;
  readonly testID: string;
  readonly query: QueryState<TechIdCard>;
  readonly viewer: 'self' | 'customer';
}) {
  const { t } = useI18n();
  const toast = useToast();
  const onCapture = useCallback(() => toast.show(t('id.captureBlocked'), 'eye-off'), [toast, t]);
  const card = query.data;
  return (
    <IdCardShield onCaptureAttempt={onCapture}>
      <Screen testID={testID} header={<Header title={title} />}>
        {query.loading && !card ? <Skeleton style={styles.skel} /> : null}
        {query.error && !card ? <ErrorView error={query.error} onRetry={query.reload} /> : null}
        {card ? (
          <TechIdCardView card={card} viewer={viewer} onOpenVerification={() => {
            const token = card.verifyUrl.split('/').pop() ?? '';
            router.push({ pathname: '/verify/[token]', params: { token } });
          }} />
        ) : null}
      </Screen>
    </IdCardShield>
  );
}

/** Web: no text selection on the card (native Text is not selectable unless asked). */
const noSelect = Platform.OS === 'web' ? ({ userSelect: 'none' } as unknown as ViewStyle) : null;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skel: { height: 560, borderRadius: radius.xxl },
  photoBox: { overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  card: { width: '100%', maxWidth: 440, alignSelf: 'center', backgroundColor: colors.surface, borderRadius: radius.xxl, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, ...shadow.raised },
  header: { height: 118, paddingHorizontal: space.xl, paddingTop: space.lg, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  arc: { position: 'absolute', right: -10, bottom: -18 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  markBox: { width: 40, height: 40, borderRadius: radius.icon, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  caption: { letterSpacing: 1.6, marginTop: space.xs },
  watermark: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 118, overflow: 'hidden', opacity: 0.035, transform: [{ rotate: '-24deg' }, { scale: 1.4 }], justifyContent: 'space-around' },
  wmRow: { letterSpacing: 1.2 },
  who: { alignItems: 'center', gap: space.xs, marginTop: -58, paddingHorizontal: space.xl },
  photoRing: { padding: 5, borderRadius: 36, backgroundColor: colors.surface, ...shadow.card, marginBottom: space.sm },
  idBlock: { alignItems: 'center', gap: 2, marginTop: space.lg, marginHorizontal: space.xl, paddingVertical: space.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, borderStyle: 'dashed' },
  code: { letterSpacing: 1.8, fontVariant: ['tabular-nums'] },
  status: { marginHorizontal: space.xl, marginTop: space.lg, padding: space.md, borderRadius: radius.md, gap: space.xs, borderWidth: 1 },
  statusOk: { backgroundColor: colors.successTint, borderColor: '#BFE8D1' },
  statusDemo: { backgroundColor: colors.demoTint, borderColor: '#DCD3FA' },
  statusWait: { backgroundColor: colors.warningTint, borderColor: '#F6DFAE' },
  statusBad: { backgroundColor: colors.dangerTint, borderColor: '#F5C6C8' },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  qrRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginHorizontal: space.xl, marginTop: space.lg },
  qrBox: { padding: 4, borderRadius: radius.md, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line },
  link: { marginTop: space.xs, paddingVertical: space.xs },
  foot: { marginTop: space.lg, marginBottom: space.lg, marginHorizontal: space.xl },
});
