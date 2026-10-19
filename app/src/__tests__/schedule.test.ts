// The technician's day schedule: jobs under way first, then booked slots by day, earliest first.
import { scheduleOf } from '../domain/schedule';
import type { Job } from '../domain/types';

const NOW = new Date(2026, 9, 22, 9, 0); // Thu 22 Oct, 9 AM

function job(id: string, over: Partial<Job>): Job {
  return { id, code: `HF-${id}`, status: 'ASSIGNED', time: { mode: 'INSTANT', window: null }, acceptedAt: 0, ...over } as unknown as Job;
}
const slot = (date: string, startHour: number) => ({ mode: 'SCHEDULED' as const, window: { date, startHour, endHour: startHour + 2 } });

describe('day schedule', () => {
  it('groups jobs under way, then today, tomorrow and later dates, each earliest first', () => {
    const groups = scheduleOf([
      job('late', { time: slot('2026-10-22', 16) }),
      job('early', { time: slot('2026-10-22', 10) }),
      job('tmrw', { time: slot('2026-10-23', 12) }),
      job('later', { time: slot('2026-10-25', 8) }),
      job('driving', { status: 'EN_ROUTE', time: slot('2026-10-22', 8) }),
      job('instant', { time: { mode: 'INSTANT', window: null } }),
      job('done', { status: 'COMPLETED', time: slot('2026-10-22', 12) }),
    ], NOW);
    expect(groups.map((g) => [g.key, g.jobs.map((j) => j.id)])).toEqual([
      ['NOW', ['instant', 'driving']],
      ['TODAY', ['early', 'late']],
      ['TOMORROW', ['tmrw']],
      ['2026-10-25', ['later']],
    ]);
  });

  it('is empty without accepted jobs', () => {
    expect(scheduleOf([job('done', { status: 'COMPLETED' })], NOW)).toEqual([]);
  });
});
