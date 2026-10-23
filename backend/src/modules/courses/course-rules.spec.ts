import { COURSES } from './course-catalog';
import { freeAccess, markQuiz, nextWatched, optionId, quizOrder, watchedEnough } from './course-rules';

describe('course rules', () => {
  it('makes basic and safety free, advanced free from 3.8★, otherwise paid', () => {
    expect(freeAccess('BASIC', null)).toBe('FREE');
    expect(freeAccess('SAFETY', 2)).toBe('FREE');
    expect(freeAccess('ADVANCED', null)).toBeNull();
    expect(freeAccess('ADVANCED', 3.79)).toBeNull();
    expect(freeAccess('ADVANCED', 3.8)).toBe('RATING');
  });

  it('moves the watched position only about as fast as time passes', () => {
    expect(nextWatched(0, 600, 0, 600)).toBe(10);
    expect(nextWatched(10, 600, 30_000, 600)).toBe(65);
    expect(nextWatched(100, 50, 30_000, 600)).toBe(100); // rewinding keeps what was watched
    expect(nextWatched(590, 700, 60_000, 600)).toBe(600);
    expect(watchedEnough(570, 600)).toBe(true);
    expect(watchedEnough(560, 600)).toBe(false);
    expect(watchedEnough(50, 60)).toBe(true);
  });

  it('marks a quiz in the order its options were shown', () => {
    const quiz = [{ options: [1, 2, 3, 4], answer: 0 }, { options: [1, 2, 3, 4], answer: 2 }];
    const order = quizOrder('seed', [4, 4]);
    const right = { '0': optionId(order[0]!.indexOf(0)), '1': optionId(order[1]!.indexOf(2)) };
    expect(markQuiz(quiz, order, right)).toEqual({ correct: 2, total: 2, passed: true });
    expect(markQuiz(quiz, order, {})).toEqual({ correct: 0, total: 2, passed: false });
  });

  it('has a complete catalogue: 18 courses, 4 lessons and 5 quiz questions each, English and Telugu', () => {
    expect(COURSES).toHaveLength(18);
    const TELUGU = /[ఀ-౿]/;
    for (const c of COURSES) {
      expect([c.id, c.lessons.length, c.quiz.length, TELUGU.test(c.title.te)]).toEqual([c.id, 4, 5, true]);
      expect(new Set(c.lessons.map((l) => l.id)).size).toBe(4);
      for (const q of c.quiz) expect([c.id, q.options.length, q.answer >= 0 && q.answer < q.options.length, TELUGU.test(q.q.te)]).toEqual([c.id, 4, true, true]);
    }
    expect(new Set(COURSES.map((c) => c.id)).size).toBe(18);
  });
});
