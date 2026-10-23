// The skill exam's rules, as plain functions (no database): the paper's three sections and their time limits, the
// points, the speed bonus and the pass mark. The server applies them; the app only shows them.
import type { SkillLevel } from '@prisma/client';

export type QuestionType = 'MCQ' | 'DIAGRAM' | 'SELECT';

export interface SectionRule {
  readonly type: QuestionType;
  /** Questions in the section. */
  readonly count: number;
  /** Time for the whole section. */
  readonly limitSec: number;
}

/** 3 MCQs in 3 minutes, 3 diagram questions in 4, 4 "choose the right part or tool" questions in 5. */
export const SECTIONS: readonly SectionRule[] = [
  { type: 'MCQ', count: 3, limitSec: 180 },
  { type: 'DIAGRAM', count: 3, limitSec: 240 },
  { type: 'SELECT', count: 4, limitSec: 300 },
];

export const QUESTIONS_PER_PAPER = SECTIONS.reduce((n, s) => n + s.count, 0);
/** Points for a right answer. */
export const POINTS = 2;
/** A right "choose the part" answer given fast earns 1.5×: 3 points instead of 2. */
export const FAST_POINTS = 3;
/** "Fast": within half the average time a question of that section has (5 min / 4 questions / 2 = 37.5 s). */
export const FAST_WITHIN_MS = (300_000 / 4) / 2;
/** Pass: 60% of the points without the speed bonus (6 of 10 right). */
export const PASS_BASE_POINTS = Math.ceil(QUESTIONS_PER_PAPER * POINTS * 0.6);
/** The most points a paper can give (every answer right, every "choose the part" answer fast). */
export const MAX_POINTS = SECTIONS.reduce((n, s) => n + s.count * (s.type === 'SELECT' ? FAST_POINTS : POINTS), 0);
/** Network grace after a section's time ends: an answer sent in the last second still counts. */
export const GRACE_MS = 5_000;
/** Leaving the app this many times submits the exam. */
export const MAX_LEFT_APP = 3;
/** After a failed exam, the same trade can be tried again after a day. */
export const RETAKE_AFTER_MS = 24 * 3_600_000;

/** How hard the questions are: the technician's own level picks the band of the question bank. */
export const BAND_FOR_LEVEL: Readonly<Record<SkillLevel, 1 | 2 | 3 | 4>> = { UNSKILLED: 1, SEMI_SKILLED: 2, SKILLED: 3, HIGHLY_SKILLED: 4 };

/** Which section a question number (0-based, in paper order) belongs to. */
export function sectionOf(index: number): number {
  let end = 0;
  for (let s = 0; s < SECTIONS.length; s++) {
    end += SECTIONS[s]!.count;
    if (index < end) return s;
  }
  return -1;
}

/** When a section ends (ms), from when it was opened. */
export function sectionEndsAt(section: number, startedAt: number): number {
  return startedAt + SECTIONS[section]!.limitSec * 1000;
}

/** The whole paper's latest end: every section opened back to back and run to its limit, plus grace. */
export function paperDeadline(startedAt: number): number {
  return startedAt + SECTIONS.reduce((n, s) => n + s.limitSec * 1000, 0) + GRACE_MS;
}

export interface Answer {
  readonly option: string;
  /** When the question was first answered and last changed (ms). */
  readonly firstAt: number;
  readonly lastAt: number;
  /** How many times the answer was changed after the first choice. */
  readonly changes: number;
}

export interface Marked {
  readonly questionId: string;
  readonly section: number;
  readonly answered: boolean;
  readonly correct: boolean;
  readonly fast: boolean;
  readonly points: number;
  /** From when the question could be reached (the section's opening, or the answer before it) to its first answer. */
  readonly secondsTaken: number | null;
  readonly changes: number;
}

export interface Score {
  readonly marked: readonly Marked[];
  readonly correct: number;
  readonly basePoints: number;
  readonly bonusPoints: number;
  readonly passed: boolean;
}

/**
 * Marks a paper. A question's time runs from the later of its section's opening and the previous first answer in
 * that section, to its own first answer; a right "choose the part" answer within FAST_WITHIN_MS earns the bonus.
 */
export function mark(
  questionIds: readonly string[],
  answerKey: (questionId: string) => string,
  answers: Readonly<Record<string, Answer>>,
  sectionStarts: readonly (number | null)[],
): Score {
  const marked: Marked[] = [];
  const lastFirstAt: (number | null)[] = SECTIONS.map(() => null);
  // Each section's answers in the order they were first given, to measure the time each one took.
  const order = questionIds.map((id, i) => ({ id, i, section: sectionOf(i), a: answers[id] }))
    .sort((x, y) => (x.a?.firstAt ?? Infinity) - (y.a?.firstAt ?? Infinity));
  const taken = new Map<string, number | null>();
  for (const q of order) {
    const start = sectionStarts[q.section] ?? null;
    if (!q.a || start === null) {
      taken.set(q.id, null);
      continue;
    }
    const from = Math.max(start, lastFirstAt[q.section] ?? start);
    taken.set(q.id, Math.max(0, q.a.firstAt - from));
    lastFirstAt[q.section] = q.a.firstAt;
  }
  let correct = 0;
  let basePoints = 0;
  let bonusPoints = 0;
  questionIds.forEach((id, i) => {
    const section = sectionOf(i);
    const a = answers[id];
    const right = !!a && a.option === answerKey(id);
    const ms = taken.get(id) ?? null;
    const fast = right && SECTIONS[section]!.type === 'SELECT' && ms !== null && ms <= FAST_WITHIN_MS;
    const points = right ? (fast ? FAST_POINTS : POINTS) : 0;
    if (right) {
      correct++;
      basePoints += POINTS;
      bonusPoints += points - POINTS;
    }
    marked.push({ questionId: id, section, answered: !!a, correct: right, fast, points, secondsTaken: ms === null ? null : Math.round(ms / 1000), changes: a?.changes ?? 0 });
  });
  return { marked, correct, basePoints, bonusPoints, passed: basePoints >= PASS_BASE_POINTS };
}
