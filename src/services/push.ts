// Push notifications (Expo push service). After sign-in, the phone's push token is registered for that account
// (customer and technician accounts separately), so updates arrive while the app is closed. Job offers use a
// high-importance Android channel ("job-offers") with sound; everything else the default one. Tapping a notification
// opens the booking or job it is about.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { Backend } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const projectId = (): string | undefined =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;

/** The push token, asking for permission once. null on the web, simulators and when the person declines. */
export async function pushToken(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Bookings', importance: Notifications.AndroidImportance.DEFAULT });
      await Notifications.setNotificationChannelAsync('job-offers', {
        name: 'Job offers', importance: Notifications.AndroidImportance.MAX, sound: 'default', vibrationPattern: [0, 400, 200, 400],
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return null;
    const id = projectId();
    if (!id) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch {
    return null;
  }
}

/** Registers this phone for the signed-in account(s); again whenever an account signs in. */
export function usePushRegistration(backend: Backend, customerToken: string | null, techToken: string | null): void {
  useEffect(() => {
    if (!customerToken && !techToken) return;
    let alive = true;
    void (async () => {
      const token = await pushToken();
      if (!token || !alive) return;
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      if (customerToken) await backend.notifications.registerDevice(customerToken, { pushToken: token, platform }).catch(() => undefined);
      if (techToken) await backend.tech.notifications.registerDevice(techToken, { pushToken: token, platform }).catch(() => undefined);
    })();
    return () => {
      alive = false;
    };
  }, [backend, customerToken, techToken]);
}

/** Where a tapped notification leads. */
export function routeFor(data: Record<string, unknown>, role: 'CUSTOMER' | 'TECHNICIAN' | null): string | null {
  const kind = typeof data.kind === 'string' ? data.kind : '';
  const bookingId = typeof data.bookingId === 'string' && /^[0-9a-f-]{36}$/i.test(data.bookingId) ? data.bookingId : null;
  if (role === 'TECHNICIAN') {
    if (kind === 'JOB_OFFER' || !bookingId) return '/tech/home';
    return `/tech/job/${bookingId}`;
  }
  return bookingId ? `/booking/${bookingId}` : null;
}

export function useNotificationTaps(role: 'CUSTOMER' | 'TECHNICIAN' | null, ready: boolean): void {
  useEffect(() => {
    if (!ready || Platform.OS === 'web') return;
    const open = (r: Notifications.NotificationResponse | null) => {
      const to = r ? routeFor((r.notification.request.content.data ?? {}) as Record<string, unknown>, role) : null;
      if (to) router.push(to as never);
    };
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [role, ready]);
}
