// The courses, written in the code (English and Telugu): per trade a basic, a safety and an advanced course, each with
// its lessons and a 5-question quiz. HQ adds a video to every lesson in the portal and then publishes the course; the
// database holds only the videos, what is published, and each technician's progress. Courses are open across trades.
import type { CategoryId } from '@prisma/client';
import acAppliance from './catalog/ac-appliance.json';
import cleaningCarpentry from './catalog/cleaning-carpentry.json';
import plumbingElectrical from './catalog/plumbing-electrical.json';

export type CourseLevel = 'BASIC' | 'SAFETY' | 'ADVANCED';

export interface Localized {
  readonly en: string;
  readonly te: string;
}

export interface CourseDef {
  readonly id: string;
  /** null: a course for every trade. */
  readonly categoryId: CategoryId | null;
  readonly level: CourseLevel;
  readonly title: Localized;
  readonly summary: Localized;
  readonly lessons: readonly { readonly id: string; readonly title: Localized }[];
  readonly quiz: readonly { readonly q: Localized; readonly options: readonly Localized[]; readonly answer: number }[];
}

export const COURSES: readonly CourseDef[] = [...plumbingElectrical, ...acAppliance, ...cleaningCarpentry] as unknown as readonly CourseDef[];

const BY_ID = new Map(COURSES.map((c) => [c.id, c]));

export function courseDef(id: string): CourseDef | null {
  return BY_ID.get(id) ?? null;
}
