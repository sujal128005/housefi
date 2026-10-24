import { learner, mentorTrades } from './apprentice-rules';

const at = new Date(0);
const base = {
  verification: 'PENDING' as const, techCode: 'N9-HF-T-ABC234', photoStatus: 'APPROVED' as const, aadhaarVerifiedAt: at, aadhaarNameMatch: true,
  aadhaarGenderMatch: true, skillLevel: 'UNSKILLED' as const, ratingCount: 0, ratingAvg: null,
  skills: [{ categoryId: 'PLUMBING' as const, verifiedAt: null }, { categoryId: 'CLEANING' as const, verifiedAt: at }],
};

describe('apprentice rules', () => {
  it('an apprentice needs a checked identity, an active account and a trade not passed yet', () => {
    expect(learner(base)).toEqual({ eligible: true, block: null, trades: ['PLUMBING'] });
    expect(learner({ ...base, photoStatus: 'PENDING' }).block).toBe('IDENTITY');
    expect(learner({ ...base, aadhaarGenderMatch: null }).block).toBe('IDENTITY');
    expect(learner({ ...base, verification: 'SUSPENDED' }).block).toBe('NOT_ACTIVE');
    expect(learner({ ...base, verification: 'APPROVED' }).eligible).toBe(true);
    expect(learner({ ...base, skills: [{ categoryId: 'PLUMBING', verifiedAt: at }] }).block).toBe('NO_TRADE');
  });

  it('a mentor teaches passed trades, when approved, skilled and well rated', () => {
    const m = { ...base, verification: 'APPROVED' as const, skillLevel: 'SKILLED' as const };
    expect(mentorTrades(m)).toEqual(['CLEANING']);
    expect(mentorTrades({ ...m, skillLevel: null })).toEqual(['CLEANING']);
    expect(mentorTrades({ ...m, skillLevel: 'SEMI_SKILLED' })).toEqual([]);
    expect(mentorTrades({ ...m, verification: 'PENDING' })).toEqual([]);
    expect(mentorTrades({ ...m, ratingCount: 2, ratingAvg: 3 })).toEqual(['CLEANING']);
    expect(mentorTrades({ ...m, ratingCount: 3, ratingAvg: 3.9 })).toEqual([]);
    expect(mentorTrades({ ...m, ratingCount: 3, ratingAvg: 4 })).toEqual(['CLEANING']);
  });
});
