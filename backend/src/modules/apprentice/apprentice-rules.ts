// Apprentice mode: who may learn on the job and who may teach. Pure functions, shared by the service and the tests.
import type { BookingStatus, CategoryId, Prisma, SkillLevel, Technician, TechnicianSkill } from '@prisma/client';

/** A trainee is added, removed or declined only before the technician arrives. */
export const TRAINEE_CHANGEABLE: readonly BookingStatus[] = ['ASSIGNED', 'EN_ROUTE'];
/** The customer can say "not today" until the technician arrives (also before one is assigned). */
export const TRAINEE_DECLINABLE: readonly BookingStatus[] = ['AWAITING_PAYMENT', 'PAYMENT_PENDING', 'MATCHING', 'MATCHING_DELAYED', 'ASSIGNED', 'EN_ROUTE'];

const MENTOR_LEVELS: readonly (SkillLevel | null)[] = ['SKILLED', 'HIGHLY_SKILLED', null];
/** A mentor's rating must be at least this once they have MENTOR_RATED_AFTER ratings. */
export const MENTOR_MIN_RATING = 4;
export const MENTOR_RATED_AFTER = 3;

type Tech = Pick<Technician, 'verification' | 'techCode' | 'photoStatus' | 'aadhaarVerifiedAt' | 'aadhaarNameMatch' | 'aadhaarGenderMatch' | 'skillLevel' | 'ratingCount'> & {
  readonly ratingAvg: Prisma.Decimal | number | null;
  readonly skills: readonly Pick<TechnicianSkill, 'categoryId' | 'verifiedAt'>[];
};

export type LearnerBlock = 'IDENTITY' | 'NOT_ACTIVE' | 'NO_TRADE';

/**
 * An apprentice: their identity is checked (Aadhaar genuine with a matching name and gender, photo approved, a
 * Technician ID) and they are not suspended or rejected; they learn trades from their profile they have not passed yet.
 * They need not be approved for jobs of their own (that needs a passed trade).
 */
export function learner(t: Tech): { readonly eligible: boolean; readonly block: LearnerBlock | null; readonly trades: CategoryId[] } {
  const trades = t.skills.filter((s) => !s.verifiedAt).map((s) => s.categoryId);
  const identity = !!t.techCode && t.photoStatus === 'APPROVED' && !!t.aadhaarVerifiedAt && t.aadhaarNameMatch === true && t.aadhaarGenderMatch === true;
  const block: LearnerBlock | null = !identity ? 'IDENTITY' : t.verification !== 'PENDING' && t.verification !== 'APPROVED' ? 'NOT_ACTIVE' : trades.length === 0 ? 'NO_TRADE' : null;
  return { eligible: block === null, block, trades };
}

/** The trades a technician may teach: approved, the trade passed, skilled or highly skilled, and well rated. */
export function mentorTrades(t: Tech): CategoryId[] {
  if (t.verification !== 'APPROVED' || !MENTOR_LEVELS.includes(t.skillLevel)) return [];
  if (t.ratingCount >= MENTOR_RATED_AFTER && Number(t.ratingAvg ?? 0) < MENTOR_MIN_RATING) return [];
  return t.skills.filter((s) => s.verifiedAt).map((s) => s.categoryId);
}

/** The same rule as a database filter (mentors to choose from), for one trade. */
export function mentorWhere(categoryId: CategoryId): Prisma.TechnicianWhereInput {
  return {
    mentorOpen: true,
    verification: 'APPROVED',
    skills: { some: { categoryId, verifiedAt: { not: null } } },
    OR: [{ skillLevel: { in: ['SKILLED', 'HIGHLY_SKILLED'] } }, { skillLevel: null }],
    AND: [{ OR: [{ ratingCount: { lt: MENTOR_RATED_AFTER } }, { ratingAvg: { gte: MENTOR_MIN_RATING } }] }],
  };
}
