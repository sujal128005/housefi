// Course rules as plain functions: who pays, when a lesson counts as watched (no skipping ahead), and the quiz.
import { seeded, shuffle } from '../skills/question-bank';
import type { CourseLevel } from './course-catalog';

/** An advanced course costs this, unless the technician's rating is at least FREE_FROM_RATING. */
export const ADVANCED_PRICE_RUPEES = 99;
export const FREE_FROM_RATING = 3.8;
/** 3 of 5 right. */
export const QUIZ_PASS_RATIO = 0.6;
/** The quiz's option ids: letters in the order shown on that try. */
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];
/** Watching may run a little faster than the clock (a late report, a 1.25× speed) but never jump ahead. */
const WATCH_SPEED_ALLOWANCE = 1.5;
const WATCH_SLACK_SEC = 10;

/** How a technician gets into a course without paying, or null when it has to be bought. */
export function freeAccess(level: CourseLevel, rating: number | null): 'FREE' | 'RATING' | null {
  if (level !== 'ADVANCED') return 'FREE';
  return rating !== null && rating >= FREE_FROM_RATING ? 'RATING' : null;
}

/** A lesson counts as watched near its end: the last 5% (at most the last 10 seconds) may be skipped. */
export function watchedEnough(watchedSec: number, durationSec: number): boolean {
  return watchedSec >= Math.max(0, Math.min(durationSec * 0.95, durationSec - 10));
}

/**
 * The new watched position from what the app reports: it may grow only about as fast as time passed since the last
 * report (so dragging the player to the end does not count), and never past the video's end or backwards.
 */
export function nextWatched(prevSec: number, reportedSec: number, elapsedMs: number, durationSec: number): number {
  const allowed = prevSec + (Math.max(0, elapsedMs) / 1000) * WATCH_SPEED_ALLOWANCE + WATCH_SLACK_SEC;
  return Math.max(prevSec, Math.min(Math.floor(reportedSec), Math.floor(allowed), durationSec));
}

/** The order the options of each quiz question are shown on one try (same seed, same order). */
export function quizOrder(seed: string, optionCounts: readonly number[]): number[][] {
  return optionCounts.map((n, i) => shuffle(Array.from({ length: n }, (_, k) => k), seeded(`${seed}:${i}`)));
}

export function optionId(shown: number): string {
  return LETTERS[shown]!;
}

/** Marks a quiz try: answers are question number → option id as shown. */
export function markQuiz(
  quiz: readonly { readonly options: readonly unknown[]; readonly answer: number }[],
  order: readonly (readonly number[])[],
  answers: Readonly<Record<string, string>>,
): { correct: number; total: number; passed: boolean } {
  let correct = 0;
  quiz.forEach((q, i) => {
    const shown = LETTERS.indexOf(answers[String(i)] ?? '');
    if (shown >= 0 && order[i]![shown] === q.answer) correct++;
  });
  return { correct, total: quiz.length, passed: correct >= Math.ceil(quiz.length * QUIZ_PASS_RATIO) };
}
