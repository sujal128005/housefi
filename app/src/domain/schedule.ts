// The technician's day schedule: the jobs they have accepted, grouped the way they plan their day. Jobs under way (or
// instant visits) come first as "Now"; booked time slots follow by day (today, tomorrow, then dates), earliest first.
import { isActive, isoDate } from './rules';
import type { Job } from './types';

export interface ScheduleGroup {
  /** NOW, TODAY, TOMORROW, or a later date ("2026-10-22"). */
  readonly key: string;
  readonly jobs: readonly Job[];
}

/** Under way: an instant visit, or a scheduled one whose trip has started. */
const underWay = (j: Job) => j.time.mode === 'INSTANT' || j.status !== 'ASSIGNED';

export function scheduleOf(jobs: readonly Job[], now: Date): ScheduleGroup[] {
  const active = jobs.filter((j) => isActive(j.status));
  const today = isoDate(now);
  const tomorrow = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const groups = new Map<string, Job[]>();
  const add = (key: string, j: Job) => groups.set(key, [...(groups.get(key) ?? []), j]);
  for (const j of active) {
    if (underWay(j) || !j.time.window) add('NOW', j);
    else add(j.time.window.date === today ? 'TODAY' : j.time.window.date === tomorrow ? 'TOMORROW' : j.time.window.date, j);
  }
  const order = (key: string) => (key === 'NOW' ? '0' : key === 'TODAY' ? '1' : key === 'TOMORROW' ? '2' : `3${key}`);
  return [...groups.entries()]
    .sort(([a], [b]) => order(a).localeCompare(order(b)))
    .map(([key, list]) => ({
      key,
      jobs: [...list].sort((a, b) => (a.time.window?.startHour ?? -1) - (b.time.window?.startHour ?? -1) || a.acceptedAt - b.acceptedAt),
    }));
}
