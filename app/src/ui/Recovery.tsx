// Graceful failure, everywhere: customers and technicians never see code, stack traces or developer screens.
// Whatever goes wrong, people only ever see the Housefi brand screen (logo, "by Nexara9", the tagline, the wave) with
// one button that carries on; never an error message, code or a developer screen.
// - ScreenErrorBoundary (around every screen, via the navigators' screenLayout): an unexpected error in a screen shows
//   the brand screen in its place; Continue goes back to home. Nothing is lost: bookings live in the backend, the
//   booking draft and sessions stay in memory and storage.
// - AppErrorBoundary: the same, around the whole app, for anything outside a screen.
// - installGlobalErrorHandler: an error outside rendering (a button handler, a timer) goes to the same screen instead
//   of closing the app or showing React Native's red error screen. Details go to the console for developers; a
//   development build shows React Native's own error tools only with EXPO_PUBLIC_DEV_ERRORS=1.
// - StartupRecovery: the same brand screen while the app starts, with Retry if it cannot.
// - OfflineBanner: a calm strip when the phone loses its connection; the current screen and its inputs stay as they are.
import NetInfo from '@react-native-community/netinfo';
import { router } from 'expo-router';
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { ActivityIndicator, Animated, LogBox, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/I18n';
import { colors, radius, space } from '../theme/tokens';
import { BrandScreen } from './BrandHero';
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

/** Developers can bring back React Native's error overlays in a development build with EXPO_PUBLIC_DEV_ERRORS=1. */
const devTools = __DEV__ && process.env.EXPO_PUBLIC_DEV_ERRORS === '1';

/** Routes uncaught JavaScript errors to the brand screen instead of closing the app or showing a red error screen. */
export function installGlobalErrorHandler(): void {
  if (installed || devTools) return;
  installed = true;
  if (__DEV__) LogBox.ignoreAllLogs(true);
  const utils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  utils?.setGlobalHandler((e, isFatal) => {
    if (__DEV__) console.warn('Housefi caught an error', e);
    // A non-fatal error was already handled where it happened; a fatal one would otherwise close the app.
    if (isFatal !== false) reportAppError(e);
  });
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('error', (ev) => {
      ev.preventDefault();
      reportAppError(ev.error);
    });
  }
}

// ---------- error boundary ----------

/** The brand screen with one way forward. */
function CrashScreen({ onContinue }: { readonly onContinue: () => void }) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.full, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <BrandScreen testID="app-error">
        <Button label={t('crash.continue')} trailingIcon="arrow-forward" onPress={onContinue} testID="app-error-continue" />
      </BrandScreen>
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

  /** Back to home; a new key remounts the screens below, so a stuck component starts fresh. */
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
    if (this.state.error) return <CrashScreen onContinue={this.home} />;
    return <View key={this.state.key} style={styles.flex}>{this.props.children}</View>;
  }
}

/** Around the whole app. */
export function AppErrorBoundary({ children }: { readonly children: ReactNode }) {
  return <ErrorBoundary app>{children}</ErrorBoundary>;
}

/** Around one screen (navigator `screenLayout`): the rest of the app stays as it is. */
export function ScreenErrorBoundary({ children }: { readonly children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

// ---------- startup ----------

/** Shown while the app starts (web has no native splash) and, with `failed` or `slow`, with a Retry button. */
export function StartupRecovery({ failed, slow, onRetry }: { readonly failed: boolean; readonly slow: boolean; readonly onRetry: () => void }) {
  return (
    <BrandScreen testID={failed ? 'startup-failed' : 'startup-loading'}>
      {/* Fonts and language may not be ready yet, so the button speaks both languages. */}
      {failed || slow ? <Button label="Retry / మళ్ళీ ప్రయత్నించండి" icon="refresh" onPress={onRetry} testID="startup-retry" /> : <ActivityIndicator color={colors.navy} size="large" />}
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
  full: { flex: 1, backgroundColor: colors.canvas },
  offline: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg, zIndex: 100, elevation: 12 },
  offlineOn: { backgroundColor: colors.ink },
  onlineOn: { backgroundColor: colors.success },
});
