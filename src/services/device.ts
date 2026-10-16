// Phone features used by the booking flow: camera / gallery photos and the current location. Everything stays on the
// device in this phase; nothing is uploaded.
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

export type PickResult = { readonly ok: true; readonly uri: string } | { readonly ok: false; readonly reason: 'CANCELLED' | 'DENIED' | 'UNAVAILABLE' };

export async function pickPhoto(source: 'camera' | 'gallery'): Promise<PickResult> {
  try {
    if (source === 'camera') {
      if (Platform.OS === 'web') return { ok: false, reason: 'UNAVAILABLE' };
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'DENIED' };
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
      return r.canceled || !r.assets[0] ? { ok: false, reason: 'CANCELLED' } : { ok: true, uri: r.assets[0].uri };
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    return r.canceled || !r.assets[0] ? { ok: false, reason: 'CANCELLED' } : { ok: true, uri: r.assets[0].uri };
  } catch {
    return { ok: false, reason: 'UNAVAILABLE' };
  }
}

export interface FoundLocation {
  readonly lat: number;
  readonly lng: number;
  readonly street: string;
  readonly city: string;
  /** State, e.g. "Andhra Pradesh". */
  readonly region: string;
  readonly pincode: string;
}

export type LocateResult = { readonly ok: true; readonly place: FoundLocation } | { readonly ok: false; readonly reason: 'DENIED' | 'OFF' | 'UNAVAILABLE' };

/** Reads the phone's position and turns it into an address (street / area, city, PIN) where the platform can. */
export async function locate(): Promise<LocateResult> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'DENIED' };
    if (Platform.OS !== 'web' && !(await Location.hasServicesEnabledAsync())) return { ok: false, reason: 'OFF' };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { latitude: lat, longitude: lng } = pos.coords;
    let street = '';
    let city = '';
    let region = '';
    let pincode = '';
    try {
      const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (a) {
        street = [a.name !== a.street ? a.name : null, a.street, a.district].filter((x): x is string => !!x && x.trim().length > 0).join(', ');
        city = a.city ?? a.subregion ?? a.region ?? '';
        region = a.region ?? '';
        pincode = a.postalCode ?? '';
      }
    } catch {
      // Turning coordinates into an address is not available everywhere (e.g. the web preview); the customer types it.
    }
    return { ok: true, place: { lat, lng, street, city, region, pincode } };
  } catch {
    return { ok: false, reason: 'UNAVAILABLE' };
  }
}
