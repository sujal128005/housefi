import { Injectable, Optional } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { distanceKm, type Place, PlacesData } from './places.data';

/** openapi.yaml Locality. */
export interface LocalityDto {
  readonly name: string;
  readonly pincodes: readonly string[];
}

/** openapi.yaml PincodePlaces: every locality that uses one PIN code (a PIN can cross a district line). */
export interface PincodeDto {
  readonly pincode: string;
  readonly places: readonly { readonly state: string; readonly district: string; readonly locality: string }[];
}

/** openapi.yaml NearPlace: the locality nearest to the phone, to fill the form in one tap. */
export interface NearPlaceDto {
  readonly state: string;
  readonly district: string;
  readonly locality: string;
  readonly pincode: string;
  /** From the phone to the locality's post office; null when India Post has no position for it. */
  readonly distanceKm: number | null;
}

/** A technician's service area, checked and written the way the directory writes it. */
export interface ServiceArea {
  readonly state: string;
  readonly district: string;
  /** Directory names; a locality the directory does not have yet keeps the name as typed. */
  readonly localities: readonly string[];
  /** The older single fields, still shown in HQ and the review CLI: the district and the localities as one line. */
  readonly city: string;
  readonly areas: string;
}

/** Further than this from every known locality, the phone is not in India (or the directory has nothing near). */
const NEAR_KM = 25;

@Injectable()
export class PlacesService {
  private loaded: PlacesData | null = null;

  /** Tests may pass a small directory; the app reads the full one on first use. */
  constructor(@Optional() data?: PlacesData) {
    this.loaded = data ?? null;
  }

  private get data(): PlacesData {
    return (this.loaded ??= PlacesData.load());
  }

  states(): string[] {
    return [...this.data.tree.keys()];
  }

  districts(state: string): string[] {
    const ds = this.data.districts(state);
    if (!ds) throw new AppError('NOT_FOUND', {}, 'no such state');
    return [...ds.keys()];
  }

  localities(state: string, district: string): LocalityDto[] {
    const d = this.data.district(state, district);
    if (!d) throw new AppError('NOT_FOUND', {}, 'no such district');
    return d.places.map((p) => ({ name: p.name, pincodes: p.pincodes }));
  }

  pincode(pin: string): PincodeDto {
    const found = this.data.pincode(pin);
    if (found.length === 0) throw new AppError('NOT_FOUND', {}, 'no such PIN code');
    // The main post office first: it usually names the area the PIN code is known by.
    const ordered = [...found].sort((a, b) => Number(b.place.main) - Number(a.place.main));
    return { pincode: pin, places: ordered.map((f) => ({ state: f.state, district: f.district, locality: f.place.name })) };
  }

  /**
   * The locality for where the phone is. India Post's positions are sometimes kilometres off, so the phone's own map
   * lookup leads when it gave a PIN code (`pincode`) and place names (`area`, e.g. "Kukatpally, Hyderabad"): among
   * the localities with that PIN, one named like the area, else the main post office, else the nearest. Without a
   * known PIN, the nearest locality with a position, within 25 km.
   */
  near(lat: number, lng: number, pincode?: string, area?: string): NearPlaceDto {
    const withPin = pincode ? this.data.pincode(pincode) : [];
    if (pincode && withPin.length > 0) {
      const names = new Set((area ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
      const named = withPin.find((f) => names.has(f.place.name.toLowerCase()));
      const mains = withPin.filter((f) => f.place.main);
      const pick = named ?? (mains.length === 1 ? mains[0] : undefined) ?? this.data.nearest(lat, lng, Infinity, pincode)?.at ?? mains[0] ?? withPin[0]!;
      const km = pick.place.lat !== null && pick.place.lng !== null ? distanceKm(lat, lng, pick.place.lat, pick.place.lng) : null;
      return { state: pick.state, district: pick.district, locality: pick.place.name, pincode, distanceKm: km === null ? null : Math.round(km * 10) / 10 };
    }
    const hit = this.data.nearest(lat, lng, NEAR_KM);
    if (!hit) throw new AppError('NOT_FOUND', {}, 'no known locality near this point');
    const { at, km } = hit;
    return { state: at.state, district: at.district, locality: at.place.name, pincode: at.place.pincodes[0]!, distanceKm: Math.round(km * 10) / 10 };
  }

  /**
   * Checks a service area: the state and district exist, and the PIN code belongs to one of the chosen localities.
   * A locality the directory does not list yet (a new post office) is allowed when the PIN code is in the district.
   */
  serviceArea(input: { readonly state: string; readonly district: string; readonly localities: readonly string[]; readonly pincode: string }): ServiceArea {
    if (!this.data.state(input.state)) throw invalid('state');
    const d = this.data.district(input.state, input.district);
    if (!d) throw invalid('district');
    const byName = new Map(d.places.map((p) => [p.name.toLowerCase(), p] as const));
    const chosen: (Place | string)[] = input.localities.map((name) => byName.get(name.trim().toLowerCase()) ?? name.trim().replace(/\s+/g, ' '));
    const known = chosen.filter((c): c is Place => typeof c !== 'string');
    const pinOk = known.some((p) => p.pincodes.includes(input.pincode))
      || (known.length < chosen.length && d.places.some((p) => p.pincodes.includes(input.pincode)));
    if (!pinOk) throw invalid('pincode');
    const localities = [...new Set(chosen.map((c) => (typeof c === 'string' ? c : c.name)))];
    const areas = localities.join(', ');
    return { state: d.state, district: d.district, localities, city: d.district.slice(0, 60), areas: areas.length > 200 ? `${areas.slice(0, 199)}…` : areas };
  }
}

const invalid = (field: string) => new AppError('VALIDATION', { fields: { [field]: 'INVALID' } }, `${field} does not match the India Post directory`);
