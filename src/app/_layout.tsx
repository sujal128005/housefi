// Root of the app: fonts, providers (state, language, backend, booking draft, toasts) and the navigation stack.
import { useFonts } from 'expo-font';
import { getLocales } from 'expo-localization';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Locale } from '../i18n/format';
import { I18nProvider } from '../i18n/I18n';
import { createMockBackend } from '../services/mock/MockBackend';
import { BackendProvider } from '../services/ServicesProvider';
import { deviceStore } from '../services/storage';
import { AppStateProvider, useAppState } from '../state/AppState';
import { BookingDraftProvider } from '../state/BookingDraft';
import { FONT_ASSETS } from '../theme/fonts';
import { colors } from '../theme/tokens';
import { ToastProvider } from '../ui';
import { CustomerAlerts } from '../ui/Notifications';
import { TechAlerts } from '../ui/TechAlerts';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
// Dev-only noise from the emulator's dev-tools socket; it is not an app problem and its toast covers the footer.
if (__DEV__) LogBox.ignoreLogs(['Cannot connect to Expo CLI']);

function phoneLocale(): Locale {
  return getLocales()[0]?.languageCode === 'te' ? 'te' : 'en';
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  // DEMO backend: the only backend in this phase. A LIVE backend implements the same interface (services/api.ts).
  const backend = useMemo(() => createMockBackend({ store: deviceStore }), []);
  return (
    <SafeAreaProvider>
      <AppStateProvider store={deviceStore} backend={backend} deviceLocale={phoneLocale()}>
        <BackendProvider backend={backend}>
          <Shell fontsReady={fontsLoaded || !!fontError} />
        </BackendProvider>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}

function Shell({ fontsReady }: { readonly fontsReady: boolean }) {
  const { ready, prefs, deviceLocale } = useAppState();
  const show = ready && fontsReady;
  useEffect(() => {
    if (show) void SplashScreen.hideAsync().catch(() => undefined);
  }, [show]);
  if (!show) return null;
  return (
    <I18nProvider locale={prefs.locale ?? deviceLocale}>
      <BookingDraftProvider>
        <ToastProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.canvas } }}>
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
        </ToastProvider>
      </BookingDraftProvider>
    </I18nProvider>
  );
}
