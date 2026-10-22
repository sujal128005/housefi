// India's states, districts and localities (post offices) with their PIN codes, from assets/places (built by
// scripts/build-places.mjs from India Post's All India Pincode Directory). Read once, on first use.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export interface Place {
  readonly name: string;
  readonly pincodes: readonly string[];
  readonly lat: number | null;
  readonly lng: number | null;
  /** A head or sub office: the main locality of its PIN code (the others are branch offices, often villages). */
  readonly main: boolean;
}

export interface Located {
  readonly state: string;
  readonly district: string;
  readonly place: Place;
}

/** The file's shape: [state, [district, [locality, pins, lat, lng, main (1 / 0)][]][]][]. */
type Raw = { readonly asOf: string; readonly states: readonly [string, readonly [string, readonly [string, readonly number[], number | null, number | null, number][]][]][] };

/** Cells of 0.1° (about 11 km) for "nearest locality to this point". */
const CELL = 0.1;
const cellKey = (lat: number, lng: number) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

export class PlacesData {
  readonly asOf: string;
  /** state → district → localities, all sorted by name. */
  readonly tree = new Map<string, Map<string, readonly Place[]>>();
  /** Lower-cased names, so "telangana" finds "Telangana". */
  private readonly stateKeys = new Map<string, string>();
  private readonly byPin = new Map<string, Located[]>();
  private readonly grid = new Map<string, Located[]>();

  constructor(raw: Raw) {
    this.asOf = raw.asOf;
    for (const [state, districts] of raw.states) {
      const ds = new Map<string, readonly Place[]>();
      this.tree.set(state, ds);
      this.stateKeys.set(state.toLowerCase(), state);
      for (const [district, places] of districts) {
        const list = places.map(([name, pins, lat, lng, main]): Place => ({ name, pincodes: pins.map(String), lat, lng, main: main === 1 }));
        ds.set(district, list);
        for (const place of list) {
          const at: Located = { state, district, place };
          for (const pin of place.pincodes) (this.byPin.get(pin) ?? this.byPin.set(pin, []).get(pin)!).push(at);
          if (place.lat !== null && place.lng !== null) {
            const key = cellKey(place.lat, place.lng);
            (this.grid.get(key) ?? this.grid.set(key, []).get(key)!).push(at);
          }
        }
      }
    }
  }

  static load(file = join(__dirname, '..', '..', '..', 'assets', 'places', 'india-pincodes.json.gz')): PlacesData {
    return new PlacesData(JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as Raw);
  }

  state(name: string): string | null {
    return this.stateKeys.get(name.trim().toLowerCase()) ?? null;
  }

  /** The districts of a state, by their exact or lower-cased name. */
  districts(state: string): Map<string, readonly Place[]> | null {
    const s = this.state(state);
    return s ? (this.tree.get(s) ?? null) : null;
  }

  district(state: string, district: string): { readonly state: string; readonly district: string; readonly places: readonly Place[] } | null {
    const s = this.state(state);
    const ds = s ? this.tree.get(s) : undefined;
    if (!s || !ds) return null;
    const want = district.trim().toLowerCase();
    for (const [name, places] of ds) if (name.toLowerCase() === want) return { state: s, district: name, places };
    return null;
  }

  pincode(pin: string): readonly Located[] {
    return this.byPin.get(pin) ?? [];
  }

  /** The nearest locality with a known position, within `maxKm`; only localities with `pincode` when given. */
  nearest(lat: number, lng: number, maxKm: number, pincode?: string): { readonly at: Located; readonly km: number } | null {
    let best: { at: Located; km: number } | null = null;
    const consider = (at: Located) => {
      if (pincode && !at.place.pincodes.includes(pincode)) return;
      const km = distanceKm(lat, lng, at.place.lat!, at.place.lng!);
      if (km <= maxKm && (!best || km < best.km)) best = { at, km };
    };
    if (pincode) {
      for (const at of this.pincode(pincode)) if (at.place.lat !== null) consider(at);
      return best;
    }
    const reach = Math.ceil(maxKm / 11) + 1;
    const [r0, c0] = [Math.floor(lat / CELL), Math.floor(lng / CELL)];
    for (let r = r0 - reach; r <= r0 + reach; r++) {
      for (let c = c0 - reach; c <= c0 + reach; c++) for (const at of this.grid.get(`${r}:${c}`) ?? []) consider(at);
    }
    return best;
  }
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
