// Root of the app: fonts, providers (state, language, backend, booking draft, toasts) and the navigation stack.
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { getRandomBytes } from 'expo-crypto';
import { useFonts } from 'expo-font';
import { getLocales } from 'expo-localization';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Image, Linking, LogBox, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Locale } from '../i18n/format';
import { I18nProvider } from '../i18n/I18n';
import { apiUrlFromEnv, createBackend } from '../services/createBackend';
import { createCheckout } from '../services/checkout';
import { useNotificationTaps, usePushRegistration } from '../services/push';
import { BackendProvider, useBackend } from '../services/ServicesProvider';
import { deviceStore, secretStore } from '../services/storage';
import { AppStateProvider, useAppState } from '../state/AppState';
import { BookingDraftProvider } from '../state/BookingDraft';
import { FONT_ASSETS } from '../theme/fonts';
import { colors } from '../theme/tokens';
import { ToastProvider } from '../ui';
import { CustomerAlerts } from '../ui/Notifications';
import { AppErrorBoundary, installGlobalErrorHandler, OfflineBanner, ScreenErrorBoundary, StartupRecovery } from '../ui/Recovery';
import { TechAlerts } from '../ui/TechAlerts';
import { hydrateCatalog } from '../data/catalog';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
// Dev-only noise from the emulator's dev-tools socket; it is not an app problem and its toast covers the footer.
if (__DEV__) LogBox.ignoreLogs(['Cannot connect to Expo CLI']);
// Installed before anything renders, so even an early error lands on the brand screen.
installGlobalErrorHandler();

function phoneLocale(): Locale {
  return getLocales()[0]?.languageCode === 'te' ? 'te' : 'en';
}

/**
 * Last resort: if the app shell itself fails (above every provider), show the brand screen and Retry, never an error.
 * Plain components only, since nothing else may be available here.
 */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }} testID="root-error">
      <Image source={require('../../assets/brand/housefi-logo.png')} style={{ width: 148, height: 148 }} />
      <Text style={{ fontSize: 44, fontWeight: '800', color: colors.ink, letterSpacing: -0.8 }}>Housefi</Text>
      <Text style={{ fontSize: 15, color: colors.inkMuted }}>
        by{' '}
        <Text onPress={() => void Linking.openURL('https://nexara9.me/').catch(() => undefined)} accessibilityRole="link"
          style={{ color: '#A27A26', fontWeight: '800', letterSpacing: 4 }}>NEXARA9</Text>
      </Text>
      <Text style={{ fontSize: 17, color: colors.inkMuted }}>Home Help, Made Easy.</Text>
      <Pressable onPress={() => void retry()} accessibilityRole="button" testID="root-error-retry"
        style={{ marginTop: 28, minHeight: 56, alignSelf: 'stretch', borderRadius: 18, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>Continue / కొనసాగించండి  →</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  // App fonts and the two icon fonts load before the splash screen hides, so no icon pops in late.
  const [fontsLoaded, fontError] = useFonts({ ...FONT_ASSETS, ...Ionicons.font, ...MaterialCommunityIcons.font });
  // The live Housefi API (services/createBackend.ts); session credentials in the secret store, payments through
  // Razorpay's checkout page, and a time limit on every call (services/timeouts.ts), so no screen can wait for ever.
  const backend = useMemo(() => createBackend(apiUrlFromEnv({
    // Written out: Expo inlines EXPO_PUBLIC_* variables only where they are named literally.
    EXPO_PUBLIC_HOUSEFI_API_URL: process.env.EXPO_PUBLIC_HOUSEFI_API_URL,
  }), {
    secrets: secretStore,
    randomBytes: getRandomBytes,
    openCheckout: createCheckout(process.env.EXPO_PUBLIC_HOUSEFI_CHECKOUT_URL || undefined),
  }), []);
  // The service catalogue comes from the backend; the bundled list stays as the fallback if this fails.
  useEffect(() => {
    void Promise.all([backend.catalog.categories(), backend.catalog.services()])
      .then(([categories, services]) => hydrateCatalog(categories, services))
      .catch(() => undefined);
  }, [backend]);
  return (
    <SafeAreaProvider>
      <AppStateProvider store={deviceStore} secrets={secretStore} backend={backend} deviceLocale={phoneLocale()}>
        <BackendProvider backend={backend}>
          <Shell fontsReady={fontsLoaded || !!fontError} />
        </BackendProvider>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}

/** How long startup may take before the "taking longer than usual" message and Retry appear. */
const SLOW_START_MS = 10_000;

function Shell({ fontsReady }: { readonly fontsReady: boolean }) {
  const { ready, failed, retryStartup, prefs, deviceLocale, session, techSession } = useAppState();
  const backend = useBackend();
  const show = ready && fontsReady;
  // Push: this phone receives the signed-in accounts' updates; a tapped notification opens its booking or job.
  usePushRegistration(backend, session?.token ?? null, techSession?.token ?? null);
  useNotificationTaps(prefs.role, show);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (show) return;
    const id = setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => clearTimeout(id);
  }, [show]);
  useEffect(() => {
    // Hide the native splash once there is something to show: the app, or the recovery screen.
    if (show || failed || slow) void SplashScreen.hideAsync().catch(() => undefined);
  }, [show, failed, slow]);
  if (!show) {
    return (
      <I18nProvider locale={prefs.locale ?? deviceLocale}>
        <StartupRecovery failed={failed} slow={slow} onRetry={() => {
          setSlow(false);
          retryStartup();
        }} />
      </I18nProvider>
    );
  }
  return (
    <I18nProvider locale={prefs.locale ?? deviceLocale}>
      <BookingDraftProvider>
        <ToastProvider>
          <StatusBar style="dark" />
          <AppErrorBoundary>
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.canvas } }}
            screenLayout={({ children }) => <ScreenErrorBoundary>{children}</ScreenErrorBoundary>}>
            <Stack.Screen name="index" options={{ animation: 'none' }} />
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen name="book/voice" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="book/confirmed" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="pay" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
            <Stack.Screen name="book/snap" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="support" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="tech/(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen name="tech/offer/[id]" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
            <Stack.Screen name="tech/quote/[id]" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="tech/verification" options={{ animation: 'fade', gestureEnabled: false }} />
          </Stack>
          <CustomerAlerts />
          <TechAlerts />
          </AppErrorBoundary>
          <OfflineBanner />
        </ToastProvider>
      </BookingDraftProvider>
    </I18nProvider>
  );
}
