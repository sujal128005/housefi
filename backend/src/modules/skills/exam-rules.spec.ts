import { FAST_WITHIN_MS, mark, MAX_POINTS, PASS_BASE_POINTS, QUESTIONS_PER_PAPER, sectionOf, SECTIONS } from './exam-rules';

const IDS = Array.from({ length: QUESTIONS_PER_PAPER }, (_, i) => `q${i}`);
const KEY = (id: string) => `right-${id}`;
const T0 = 1_000_000;

describe('skill exam rules', () => {
  it('has 3 MCQs, 3 diagram questions and 4 part questions; 60% to pass; 24 points at most', () => {
    expect(SECTIONS.map((s) => [s.type, s.count, s.limitSec])).toEqual([['MCQ', 3, 180], ['DIAGRAM', 3, 240], ['SELECT', 4, 300]]);
    expect(QUESTIONS_PER_PAPER).toBe(10);
    expect(PASS_BASE_POINTS).toBe(12);
    expect(MAX_POINTS).toBe(24);
    expect([0, 2, 3, 5, 6, 9, 10].map(sectionOf)).toEqual([0, 0, 1, 1, 2, 2, -1]);
  });

  it('gives 2 points a right answer, 3 for a fast right part answer, and counts answer changes', () => {
    const starts = [T0, T0 + 100_000, T0 + 300_000];
    const answers: Record<string, { option: string; firstAt: number; lastAt: number; changes: number }> = {};
    const inSection = [0, 0, 0];
    IDS.forEach((id, i) => {
      const s = sectionOf(i);
      // Every answer 10 s after the one before it in its section: the part questions are all fast.
      const at = starts[s]! + 10_000 * ++inSection[s]!;
      answers[id] = { option: KEY(id), firstAt: at, lastAt: at, changes: i === 0 ? 2 : 0 };
    });
    const r = mark(IDS, KEY, answers, starts);
    expect(r.correct).toBe(10);
    expect(r.basePoints).toBe(20);
    expect(r.bonusPoints).toBe(4);
    expect(r.passed).toBe(true);
    expect(r.marked[0]).toMatchObject({ changes: 2, correct: true, points: 2 });
  });

  it('measures each part question from the answer before it, so slow ones get no bonus', () => {
    const starts = [T0, T0 + 1, T0 + 2];
    const answers = {
      q6: { option: KEY('q6'), firstAt: T0 + 2 + FAST_WITHIN_MS, lastAt: T0 + 2 + FAST_WITHIN_MS, changes: 0 },
      q7: { option: KEY('q7'), firstAt: T0 + 2 + FAST_WITHIN_MS + FAST_WITHIN_MS + 1, lastAt: 0, changes: 0 },
      q8: { option: 'wrong', firstAt: T0 + 2 + FAST_WITHIN_MS * 2 + 2000, lastAt: 0, changes: 1 },
    };
    const r = mark(IDS, KEY, answers, starts);
    expect(r.marked[6]).toMatchObject({ fast: true, points: 3 });
    expect(r.marked[7]).toMatchObject({ fast: false, points: 2 });
    expect(r.marked[8]).toMatchObject({ correct: false, points: 0, changes: 1 });
    expect(r.marked[9]).toMatchObject({ answered: false, points: 0, secondsTaken: null });
    expect(r.passed).toBe(false);
  });

  it('passes at exactly 6 right answers', () => {
    const answers = Object.fromEntries(IDS.slice(0, 6).map((id) => [id, { option: KEY(id), firstAt: T0 + 1000, lastAt: T0 + 1000, changes: 0 }]));
    const r = mark(IDS, KEY, answers, [T0, T0, T0]);
    expect([r.correct, r.basePoints, r.passed]).toEqual([6, 12, true]);
    const five = mark(IDS, KEY, Object.fromEntries(Object.entries(answers).slice(0, 5)), [T0, T0, T0]);
    expect(five.passed).toBe(false);
  });
});
