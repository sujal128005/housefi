// Small checks for JSON from the live backend: each decoder returns a typed value or throws, and the transport turns
// a throw into BAD_RESPONSE. Decoders exist for the responses where a wrong shape could mislead people (identity and
// verification); the rest are added with the HTTP client once the backend team confirms each endpoint.
import type { CategoryId, Gender, TechIdCard, TechVerifyResult, Verification } from '../../domain/types';

export class DecodeError extends Error {}

export function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new DecodeError(`${what}: expected an object`);
  return v as Record<string, unknown>;
}
export function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new DecodeError(`${k}: expected text`);
  return v;
}
export function strOrNull(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new DecodeError(`${k}: expected text or null`);
  return v;
}
export function bool(o: Record<string, unknown>, k: string): boolean {
  const v = o[k];
  if (typeof v !== 'boolean') throw new DecodeError(`${k}: expected true/false`);
  return v;
}
export function num(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DecodeError(`${k}: expected a number`);
  return v;
}
export function oneOf<T extends string>(o: Record<string, unknown>, k: string, allowed: readonly T[]): T {
  const v = o[k];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new DecodeError(`${k}: unexpected value`);
  return v as T;
}

const VERIFICATION: readonly Verification[] = ['PENDING', 'APPROVED', 'NEEDS_CORRECTION', 'REJECTED', 'SUSPENDED'];
const GENDER: readonly Gender[] = ['M', 'F'];
const PHOTO_STATUS = ['PENDING', 'APPROVED', 'REJECTED'] as const;

/** The digital ID card (GET /tech/id-card, GET /bookings/{id}/technician-card). */
export function decodeTechIdCard(json: unknown): TechIdCard {
  const o = obj(json, 'id card');
  const skills = o.skills;
  if (!Array.isArray(skills) || skills.some((s) => typeof s !== 'string')) throw new DecodeError('skills: expected a list');
  return {
    techCode: str(o, 'techCode'), name: str(o, 'name'), photo: strOrNull(o, 'photo'), photoStatus: oneOf(o, 'photoStatus', PHOTO_STATUS),
    gender: oneOf(o, 'gender', GENDER), skills: skills as CategoryId[], verification: oneOf(o, 'verification', VERIFICATION),
    // Must be an explicit true/false: an approval whose origin is unknown is never shown as verified.
    simulated: bool(o, 'simulated'), verifyUrl: str(o, 'verifyUrl'), verifyIsDemo: bool(o, 'verifyIsDemo'), fictional: bool(o, 'fictional'),
  };
}

/** The public verification page's answer (GET /verify/technicians/{token}). */
export function decodeTechVerifyResult(json: unknown): TechVerifyResult {
  const o = obj(json, 'verification');
  return {
    techCode: str(o, 'techCode'), displayName: str(o, 'displayName'), photo: strOrNull(o, 'photo'), gender: oneOf(o, 'gender', GENDER),
    verification: oneOf(o, 'verification', VERIFICATION), simulated: bool(o, 'simulated'), active: bool(o, 'active'),
    checkedAt: num(o, 'checkedAt'), fictional: bool(o, 'fictional'),
  };
}
