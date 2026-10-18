// The technician's position, sent while they are online or on a job and the app is open: about once a minute, or after
// moving 50 m. The API keeps only the latest point (no history), uses it for job matching and the ETA, and shows it to
// the customer only while the technician is on the way.
import * as Location from 'expo-location';
import { useEffect } from 'react';
import { useBackend } from './ServicesProvider';

const EVERY_MS = 60_000;
const MIN_MOVE_M = 50;

export function useLocationReporter(token: string, enabled: boolean): void {
  const backend = useBackend();
  useEffect(() => {
    if (!enabled || !token) return;
    let stopped = false;
    let sub: Location.LocationSubscription | null = null;
    let last = 0;
    const send = (pos: Location.LocationObject) => {
      const t = Date.now();
      if (t - last < EVERY_MS / 2) return;
      last = t;
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      void backend.tech.sendLocation(token, { lat, lng, ...(accuracy != null ? { accuracy: Math.round(accuracy) } : {}) }).catch(() => undefined);
    };
    void (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted || stopped) return;
        const first = await Location.getLastKnownPositionAsync().catch(() => null);
        if (first) send(first);
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: EVERY_MS, distanceInterval: MIN_MOVE_M }, send);
        if (stopped) sub.remove();
      } catch {
        // Location off or unavailable: matching falls back to the technician's home area.
      }
    })();
    return () => {
      stopped = true;
      sub?.remove();
    };
  }, [backend, token, enabled]);
}
