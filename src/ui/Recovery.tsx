// Graceful failure, everywhere: customers and technicians never see code, stack traces or developer screens.
// - ScreenErrorBoundary (around every screen, via the navigators' screenLayout): an unexpected error in a screen shows a
//   branded "Something went wrong" in place of that screen only, with Try again (re-opens the same screen) and Go to
//   home. Nothing is lost: bookings live in the backend, the booking draft and sessions stay in memory and storage.
// - AppErrorBoundary: the same, around the whole app, for anything outside a screen.
// - installGlobalErrorHandler: in release builds, an error outside rendering (a button handler, a timer) goes to the
//   same screen instead of closing the app. Development builds keep React Native's developer tools.
// - StartupRecovery: the branded first screen with a friendly message and Retry when the app cannot start.
// - OfflineBanner: a calm strip when the phone loses its connection; the current screen and its inputs stay as they are.
import NetInfo from '@react-native-community/netinfo';
import { router } from 'expo-router';
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/I18n';
import { colors, radius, space } from '../theme/tokens';
import { BrandLockup, BrandScreen, BrandWave } from './BrandHero';
import { Button } from './Button';
import { Icon } from './Icon';
import { Txt } from './Txt';

// ---------- one channel for "show the error screen" ----------

type Listener = (e: unknown) => void;
let listener: Listener | null = null;

/** Shows the branded error screen for an error that happened outside rendering. */
export function reportAppError(e: unknown): void {
  listener?.(e);
}

interface GlobalErrorUtils {
  getGlobalHandler(): (e: unknown, isFatal?: boolean) => void;
  setGlobalHandler(h: (e: unknown, isFatal?: boolean) => void): void;
}

let installed = false;

/** Release builds: route uncaught JavaScript errors to the branded error screen instead of closing the app. */
export function installGlobalErrorHandler(): void {
  const utils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  if (installed || !utils || __DEV__) return;
  installed = true;
  utils.setGlobalHandler((e) => reportAppError(e));
}

// ---------- error boundary ----------

function CrashScreen({ onRetry, onHome }: { readonly onRetry: () => void; readonly onHome: () => void }) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.full, { paddingTop: insets.top + space.xl, paddingBottom: Math.max(insets.bottom, space.lg) + space.md }]} testID="app-error">
      <BrandWave height={200} />
      <View style={styles.middle}>
        <BrandLockup compact />
        <View style={styles.message}>
          <Txt variant="title2" align="center" heading>{t('crash.title')}</Txt>
          <Txt variant="body" color="inkMuted" align="center">{t('crash.body')}</Txt>
        </View>
      </View>
      <View style={styles.actions}>
        <Button label={t('crash.retry')} icon="refresh" onPress={onRetry} testID="app-error-retry" />
        <Button label={t('crash.home')} variant="outline" icon="home-outline" onPress={onHome} testID="app-error-home" />
      </View>
    </View>
  );
}

interface BoundaryState {
  readonly error: unknown;
  readonly key: number;
}

/** Catches errors below it and shows the branded fallback. `app`: also receives errors from outside rendering. */
class ErrorBoundary extends Component<{ readonly children: ReactNode; readonly app?: boolean }, BoundaryState> {
  state: BoundaryState = { error: null, key: 0 };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error: error ?? new Error('unknown') };
  }

  componentDidMount(): void {
    if (this.props.app) listener = (e) => this.setState({ error: e ?? new Error('unknown') });
  }

  componentWillUnmount(): void {
    if (this.props.app) listener = null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Developers see the details in the console; people using the app never do.
    if (__DEV__) console.warn('Housefi caught an error', error, info.componentStack);
  }

  private retry = (): void => {
    // A new key remounts the screens below, so a stuck component starts fresh.
    this.setState((s) => ({ error: null, key: s.key + 1 }));
  };

  private home = (): void => {
    this.setState((s) => ({ error: null, key: s.key + 1 }));
    setTimeout(() => {
      try {
        if (router.canDismiss()) router.dismissAll();
        router.replace('/');
      } catch {
        // The navigator rebuilds itself on the next render.
      }
    }, 0);
  };

  render(): ReactNode {
    if (this.state.error) return <CrashScreen onRetry={this.retry} onHome={this.home} />;
    return <View key={this.state.key} style={styles.flex}>{this.props.children}</View>;
  }
}

/** Around the whole app. */
export function AppErrorBoundary({ children }: { readonly children: ReactNode }) {
  return <ErrorBoundary app>{children}</ErrorBoundary>;
}

/** Around one screen (navigator `screenLayout`): Try again re-opens that screen, the rest of the app stays as it is. */
export function ScreenErrorBoundary({ children }: { readonly children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

// ---------- startup ----------

/** Shown while the app starts (web has no native splash) and, with `failed`, when it could not start. */
export function StartupRecovery({ failed, slow, onRetry }: { readonly failed: boolean; readonly slow: boolean; readonly onRetry: () => void }) {
  return (
    <BrandScreen testID={failed ? 'startup-failed' : 'startup-loading'}>
      {failed || slow ? (
        <>
          {/* Fonts and language may not be ready yet, so this message is short and in both languages. */}
          <Txt variant="title3" align="center" lang="en">{failed ? "We couldn't open Housefi" : 'This is taking longer than usual'}</Txt>
          <Txt variant="callout" color="inkMuted" align="center" lang="te">{failed ? 'Housefi తెరవలేకపోయాం. మళ్ళీ ప్రయత్నించండి.' : 'సాధారణం కంటే ఎక్కువ సమయం పడుతోంది.'}</Txt>
          <Txt variant="footnote" color="inkSubtle" align="center" lang="en">Your bookings and details are safe.</Txt>
          <Button label="Retry / మళ్ళీ ప్రయత్నించండి" icon="refresh" onPress={onRetry} testID="startup-retry" />
        </>
      ) : (
        <ActivityIndicator color={colors.navy} size="large" />
      )}
    </BrandScreen>
  );
}

// ---------- offline ----------

/** A strip at the top while the phone is offline, and a short "Back online" when it reconnects. */
export function OfflineBanner() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);
  const [back, setBack] = useState(false);
  const was = useRef(false);
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => NetInfo.addEventListener((s) => {
    const off = s.isConnected === false;
    if (was.current && !off) {
      setBack(true);
      setTimeout(() => setBack(false), 2500);
    }
    was.current = off;
    setOffline(off);
  }), []);

  const show = offline || back;
  useEffect(() => {
    Animated.timing(v, { toValue: show ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  }, [show, v]);

  if (!show) return null;
  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" testID={offline ? 'offline-banner' : 'online-banner'}
      style={[styles.offline, { top: insets.top + space.xs, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] },
        offline ? styles.offlineOn : styles.onlineOn]}>
      <Icon name={offline ? 'cloud-offline' : 'cloud-done'} size={18} color="onNavy" />
      <View style={styles.flex}>
        <Txt variant="label" color="onNavy">{offline ? t('offline.title') : t('offline.back')}</Txt>
        {offline ? <Txt variant="caption" color="onNavyMuted">{t('offline.body')}</Txt> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  full: { flex: 1, backgroundColor: colors.canvas, paddingHorizontal: space.xl },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl },
  message: { gap: space.sm, maxWidth: 420 },
  actions: { gap: space.sm, width: '100%', maxWidth: 520, alignSelf: 'center' },
  offline: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg, zIndex: 100, elevation: 12 },
  offlineOn: { backgroundColor: colors.ink },
  onlineOn: { backgroundColor: colors.success },
});
