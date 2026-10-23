// Small checks for JSON from the live backend: each decoder returns a typed value or throws, and the transport turns
// a throw into BAD_RESPONSE. Decoders exist for the responses where a wrong shape could mislead people (identity and
// verification); the rest are added with the HTTP client once the backend team confirms each endpoint.
import type { CategoryId, Certification, Gender, MyPassport, SkillLevel, SkillPassport, TechIdCard, TechVerifyResult, TradeProof, Verification } from '../../domain/types';

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
    passport: o.passport === null || o.passport === undefined ? null : decodeSkillPassport(o.passport),
  };
}

const LEVEL: readonly SkillLevel[] = ['UNSKILLED', 'SEMI_SKILLED', 'SKILLED', 'HIGHLY_SKILLED'];
const PROOF: readonly TradeProof[] = ['EXAM', 'VIDEO', 'HQ', 'EARLIER'];
const CERT_KIND = ['ITI', 'SKILL_INDIA', 'OTHER', 'HOUSEFI_COURSE'] as const;

function list(o: Record<string, unknown>, k: string): Record<string, unknown>[] {
  const v = o[k];
  if (!Array.isArray(v)) throw new DecodeError(`${k}: expected a list`);
  return v.map((x) => obj(x, k));
}
function numOrNull(o: Record<string, unknown>, k: string): number | null {
  return o[k] === null ? null : num(o, k);
}

/** The Skill Passport (on the public verification answer and GET /tech/passport). */
export function decodeSkillPassport(json: unknown): SkillPassport {
  const o = obj(json, 'passport');
  return {
    memberSince: num(o, 'memberSince'), experienceYears: num(o, 'experienceYears'), city: str(o, 'city'),
    level: o.level === null ? null : oneOf(o, 'level', LEVEL), jobsDone: num(o, 'jobsDone'), rating: numOrNull(o, 'rating'), ratingCount: num(o, 'ratingCount'),
    trades: list(o, 'trades').map((t) => ({
      categoryId: str(t, 'categoryId') as CategoryId, provenBy: oneOf(t, 'provenBy', PROOF), examPoints: numOrNull(t, 'examPoints'), examMaxPoints: numOrNull(t, 'examMaxPoints'), at: num(t, 'at'),
    })),
    courses: list(o, 'courses').map((c) => ({ title: str(c, 'title'), at: num(c, 'at') })),
    certificates: list(o, 'certificates').map((c): Certification => ({ kind: oneOf(c, 'kind', CERT_KIND), title: str(c, 'title') })),
  };
}

/** GET/PUT /tech/passport. */
export function decodeMyPassport(json: unknown): MyPassport {
  const o = obj(json, 'my passport');
  return { public: bool(o, 'public'), link: str(o, 'link'), passport: decodeSkillPassport(o.passport) };
}
