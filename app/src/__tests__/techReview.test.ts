// Technician registration steps: details → Aadhaar → skill check → checking (until the promised time) → verified.
import { approvalShown, techHref, techStage } from '../domain/techReview';
import { formatClock } from '../i18n/format';

const AADHAAR = { last4: '1234', nameMatches: true, verifiedAt: 1 };
const T0 = Date.UTC(2026, 9, 16, 4, 30);
const HOUR = 3_600_000;

describe('technician registration steps', () => {
  it('goes details → Aadhaar → checking', () => {
    expect(techStage({ verification: null, aadhaar: null, reviewBy: null }, T0)).toBe('DETAILS');
    expect(techStage({ verification: 'PENDING', aadhaar: null, reviewBy: T0 + 2 * HOUR }, T0)).toBe('AADHAAR');
    expect(techStage({ verification: 'PENDING', aadhaar: AADHAAR, reviewBy: T0 + 2 * HOUR }, T0)).toBe('CHECKING');
  });

  it('asks for the skill check after the Aadhaar scan, until it is sent', () => {
    const skills = (required: boolean) => ({ level: null, required, submittedAt: required ? null : T0, verifiedSkills: [], certifications: [] });
    const p = { verification: 'PENDING' as const, aadhaar: AADHAAR, reviewBy: T0 + 2 * HOUR };
    expect(techStage({ ...p, skillCheck: skills(true) }, T0)).toBe('SKILLS');
    expect(techHref({ ...p, skillCheck: skills(true) }, T0)).toBe('/tech/skills');
    expect(techStage({ ...p, skillCheck: skills(false) }, T0)).toBe('CHECKING');
    // Before the Aadhaar scan, the scan comes first.
    expect(techStage({ ...p, aadhaar: null, skillCheck: skills(true) }, T0)).toBe('AADHAAR');
  });

  it('shows an approval only from the promised time, even when it was given earlier', () => {
    const approved = { verification: 'APPROVED' as const, aadhaar: AADHAAR, reviewBy: T0 + 2 * HOUR };
    expect(techStage(approved, T0 + HOUR)).toBe('CHECKING');
    expect(approvalShown(approved, T0 + HOUR)).toBe(false);
    expect(techHref(approved, T0 + HOUR)).toBe('/tech/verification');
    expect(techStage(approved, T0 + 2 * HOUR)).toBe('READY');
    expect(techHref(approved, T0 + 2 * HOUR)).toBe('/tech/home');
    // Profiles from before review times (or a server without them) are shown as they are.
    expect(approvalShown({ verification: 'APPROVED', aadhaar: null }, T0)).toBe(true);
  });

  it('shows a correction at once, and stops on rejection or suspension', () => {
    expect(techStage({ verification: 'NEEDS_CORRECTION', aadhaar: AADHAAR, reviewBy: T0 + 2 * HOUR }, T0)).toBe('FIX');
    expect(techStage({ verification: 'REJECTED', aadhaar: AADHAAR, reviewBy: T0 }, T0)).toBe('STOPPED');
    expect(techStage({ verification: 'SUSPENDED', aadhaar: AADHAAR, reviewBy: T0 }, T0)).toBe('STOPPED');
  });

  it('opens the right screen for each step', () => {
    expect(techHref({ verification: null, aadhaar: null, reviewBy: null }, T0)).toBe('/tech/setup');
    expect(techHref({ verification: 'PENDING', aadhaar: null, reviewBy: T0 }, T0)).toBe('/tech/aadhaar');
    expect(techHref({ verification: 'NEEDS_CORRECTION', aadhaar: null, reviewBy: T0 }, T0)).toBe('/tech/verification');
  });

  it('writes the promised time the way people say it', () => {
    expect(formatClock(new Date(2026, 9, 16, 16, 30), 'en')).toBe('4:30 PM');
    expect(formatClock(new Date(2026, 9, 16, 9, 0), 'en')).toBe('9 AM');
    expect(formatClock(new Date(2026, 9, 16, 16, 30), 'te')).toBe('సాయంత్రం 4:30');
    expect(formatClock(new Date(2026, 9, 16, 0, 5), 'en')).toBe('12:05 AM');
  });
});
