// Phone features: camera / gallery photos (booking problems, the technician's profile photo) and the current location.
// Every photo is re-saved as a JPEG of sensible size before it is uploaded: the API accepts JPEG, PNG and HEIC only (not
// WebP and the like), a smaller file uploads faster on mobile data, and re-saving drops the camera's metadata.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
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
      return r.canceled || !r.assets[0] ? { ok: false, reason: 'CANCELLED' } : { ok: true, uri: await asJpeg(r.assets[0].uri, r.assets[0].width) };
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    return r.canceled || !r.assets[0] ? { ok: false, reason: 'CANCELLED' } : { ok: true, uri: await asJpeg(r.assets[0].uri, r.assets[0].width) };
  } catch {
    return { ok: false, reason: 'UNAVAILABLE' };
  }
}

/** Longest side of an uploaded problem photo. */
const PHOTO_MAX_PX = 1600;

/** The photo as a JPEG file at most PHOTO_MAX_PX wide. */
async function asJpeg(uri: string, width: number): Promise<string> {
  let image = ImageManipulator.manipulate(uri);
  if (width > PHOTO_MAX_PX) image = image.resize({ width: PHOTO_MAX_PX });
  const rendered = await image.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
  return saved.uri;
}

export type ProfilePhotoResult = { readonly ok: true; readonly photo: string } | { readonly ok: false; readonly reason: 'CANCELLED' | 'DENIED' | 'UNAVAILABLE' };

/**
 * The technician's profile photo: a live photo (front camera) or one from the gallery, cropped square and shrunk to
 * a 480 px JPEG file (about 40 KB). It is uploaded with the registration and goes nowhere else.
 */
export async function pickProfilePhoto(source: 'camera' | 'gallery'): Promise<ProfilePhotoResult> {
  try {
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, exif: false };
    let r: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      if (Platform.OS === 'web') return { ok: false, reason: 'UNAVAILABLE' };
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'DENIED' };
      r = await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front });
    } else {
      r = await ImagePicker.launchImageLibraryAsync(options);
    }
    const asset = r.canceled ? undefined : r.assets[0];
    if (!asset) return { ok: false, reason: 'CANCELLED' };
    const image = await ImageManipulator.manipulate(asset.uri).resize({ width: 480 }).renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
    return saved.uri ? { ok: true, photo: saved.uri } : { ok: false, reason: 'UNAVAILABLE' };
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
