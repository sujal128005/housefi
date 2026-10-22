// A few places from India Post's directory for the test double (the live API has all of India: backend/assets/places).
// Names and PIN codes as the directory writes them.
import type { Greeting, Locality, NearPlace, PincodePlaces } from '../../domain/types';
import { ApiError } from '../api';

type Place = Locality & { readonly lat: number; readonly lng: number };

const DIRECTORY: Readonly<Record<string, Readonly<Record<string, readonly Place[]>>>> = {
  'Andhra Pradesh': {
    Visakhapatnam: [
      { name: 'Dwarakanagar', pincodes: ['530016'], lat: 17.7287, lng: 83.3058 },
      { name: 'Gajuwaka', pincodes: ['530026'], lat: 17.6868, lng: 83.2185 },
    ],
  },
  Delhi: {
    'New Delhi': [{ name: 'Connaught Place', pincodes: ['110001'], lat: 28.6315, lng: 77.2167 }],
  },
  'Himachal Pradesh': {
    Shimla: [{ name: 'Shimla', pincodes: ['171001'], lat: 31.1048, lng: 77.1734 }],
  },
  Telangana: {
    Hyderabad: [
      { name: 'Banjara Hills', pincodes: ['500034'], lat: 17.4172, lng: 78.4359 },
      { name: 'Cyberabad', pincodes: ['500081'], lat: 17.4474, lng: 78.3963 },
      { name: 'Himayathnagar', pincodes: ['500029'], lat: 17.4013, lng: 78.4867 },
      { name: 'Jubilee Hills', pincodes: ['500033'], lat: 17.43, lng: 78.4174 },
      { name: 'Khairatabad', pincodes: ['500004'], lat: 17.4156, lng: 78.4613 },
    ],
    'Medchal Malkajgiri': [
      { name: 'Bachupally', pincodes: ['500090'], lat: 17.5449, lng: 78.3617 },
      { name: 'Kukatpally', pincodes: ['500072'], lat: 17.4849, lng: 78.4138 },
    ],
    'Ranga Reddy': [
      { name: 'Kokapet', pincodes: ['500075'], lat: 17.3964, lng: 78.3335 },
      { name: 'Narsingi', pincodes: ['500089'], lat: 17.3881, lng: 78.3581 },
    ],
  },
};

const find = <T,>(map: Readonly<Record<string, T>>, name: string): [string, T] | null => {
  const key = Object.keys(map).find((k) => k.toLowerCase() === name.trim().toLowerCase());
  return key ? [key, map[key]!] : null;
};

const all = (): { state: string; district: string; place: Place }[] =>
  Object.entries(DIRECTORY).flatMap(([state, ds]) => Object.entries(ds).flatMap(([district, ps]) => ps.map((place) => ({ state, district, place }))));

export const mockPlaces = {
  states: (): readonly string[] => Object.keys(DIRECTORY),
  districts(state: string): readonly string[] {
    const s = find(DIRECTORY, state);
    if (!s) throw new ApiError('NOT_FOUND');
    return Object.keys(s[1]);
  },
  localities(state: string, district: string): readonly Locality[] {
    const d = find(find(DIRECTORY, state)?.[1] ?? {}, district);
    if (!d) throw new ApiError('NOT_FOUND');
    return d[1].map(({ name, pincodes }) => ({ name, pincodes }));
  },
  pincode(pin: string): PincodePlaces {
    const places = all().filter((x) => x.place.pincodes.includes(pin)).map((x) => ({ state: x.state, district: x.district, locality: x.place.name }));
    if (places.length === 0) throw new ApiError('NOT_FOUND');
    return { pincode: pin, places };
  },
  near(lat: number, lng: number, pincode?: string): NearPlace {
    const km = (p: Place) => Math.hypot(p.lat - lat, (p.lng - lng) * Math.cos((lat * Math.PI) / 180)) * 111;
    const pool = all().filter((x) => !pincode || x.place.pincodes.includes(pincode));
    const best = (pool.length > 0 ? pool : all()).sort((a, b) => km(a.place) - km(b.place))[0];
    if (!best || km(best.place) > 25) throw new ApiError('NOT_FOUND');
    return { state: best.state, district: best.district, locality: best.place.name, pincode: pincode && best.place.pincodes.includes(pincode) ? pincode : best.place.pincodes[0]!, distanceKm: Math.round(km(best.place) * 10) / 10 };
  },
  /** The server's check: the PIN code belongs to a chosen locality (or, with a name the directory lacks, to the district). */
  serviceAreaOk(state: string, district: string, localities: readonly string[], pincode: string): boolean {
    const d = find(find(DIRECTORY, state)?.[1] ?? {}, district);
    if (!d || localities.length === 0) return false;
    const known = d[1].filter((p) => localities.some((l) => l.toLowerCase() === p.name.toLowerCase()));
    return known.some((p) => p.pincodes.includes(pincode)) || (known.length < localities.length && d[1].some((p) => p.pincodes.includes(pincode)));
  },
};

/** The test double's greeting: always the Diwali one, so screens can be tested with it. */
export function mockGreeting(now: number): Greeting {
  return {
    id: 'diwali-demo',
    theme: 'lights',
    title: { en: 'Happy Diwali', te: 'దీపావళి శుభాకాంక్షలు' },
    body: { en: 'May every corner of your home glow. Get a spotless home and safe lights before the festival.', te: 'మీ ఇంటి ప్రతి మూల వెలుగులతో నిండాలి. పండుగకు ముందే ఇల్లు శుభ్రంగా, లైట్లు సురక్షితంగా.' },
    categoryId: 'CLEANING',
    cta: { en: 'Book a festive clean', te: 'పండుగ క్లీనింగ్ బుక్ చేయండి' },
    techBody: { en: 'Festive weeks are the busiest: stay online to get more jobs. Have a bright Diwali!', te: 'పండుగ రోజుల్లో పని ఎక్కువ: ఎక్కువ పనుల కోసం ఆన్‌లైన్‌లో ఉండండి. దీపావళి శుభాకాంక్షలు!' },
    until: now + 86_400_000,
  };
}
