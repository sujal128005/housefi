// The test double's skill check: the same rules as the server (level first, sections in order, time limits, 2 points a
// right answer, 3 for a fast part answer, 60% to pass, the third exit submits) on a small made-up paper. Kept in memory.
import { ApiError, type TechApi } from '../api';
import type { CategoryId, ExamQuestion, SkillCheck, SkillExam, SkillLevel } from '../../domain/types';

const SECTIONS = [
  { type: 'MCQ', count: 3, limitSec: 180 },
  { type: 'DIAGRAM', count: 3, limitSec: 240 },
  { type: 'SELECT', count: 4, limitSec: 300 },
] as const;
const GRACE_MS = 5000;
const FAST_MS = 37_500;
const MAX_LEFT_APP = 3;
const RETAKE_MS = 24 * 3_600_000;

/** A made-up paper: the right option is always "a" (the double has no shuffle). */
function paper(): ExamQuestion[] {
  const text = (n: number) => ({ en: `Question ${n}`, te: `ప్రశ్న ${n}` });
  const options = (arts: readonly (string | null)[]) => arts.map((art, i) => ({ id: 'abcd'[i]!, en: art ? null : `Option ${i + 1}`, te: art ? null : `ఎంపిక ${i + 1}`, art }));
  return [
    ...[1, 2, 3].map((n) => ({ id: `m${n}`, section: 0, type: 'MCQ' as const, q: text(n), art: null, options: options([null, null, null, null]) })),
    ...[4, 5, 6].map((n) => ({ id: `d${n}`, section: 1, type: 'DIAGRAM' as const, q: text(n), art: 'scene.pl.sink', options: options(['label.A', 'label.B', 'label.C', 'label.D']) })),
    ...[7, 8, 9, 10].map((n) => ({ id: `s${n}`, section: 2, type: 'SELECT' as const, q: text(n), art: null, options: options(['part.elbow', 'part.tee', 'part.coupler', 'part.end-cap']) })),
  ].map((q) => ({ ...q, options: q.options.map((o) => ({ ...o, en: o.art ? 'Part' : o.en, te: o.art ? 'భాగం' : o.te })) }));
}

interface Attempt {
  exam: SkillExam;
  first: Record<string, number>;
  changes: Record<string, number>;
}

interface TechSkills {
  level: SkillLevel | null;
  submittedAt: number | null;
  verified: Partial<Record<CategoryId, 'EXAM' | 'VIDEO' | 'HQ' | 'EARLIER'>>;
  attempts: Attempt[];
  video: SkillCheck['video'];
  certificates: SkillCheck['certificates'][number][];
}

type SkillMethods = Pick<TechApi, 'skills' | 'setSkillLevel' | 'startExam' | 'exam' | 'startExamSection' | 'answerExam' | 'examLeftApp' | 'submitExam' | 'sendSkillVideo' | 'addCertificate' | 'removeCertificate' | 'submitSkills'>;

export function createMockSkills(deps: {
  readonly now: () => number;
  readonly id: (prefix: string) => string;
  /** The signed-in technician: id, trades, and whether it is a demo account. */
  readonly who: (token: string) => Promise<{ readonly id: string; readonly skills: readonly CategoryId[]; readonly demo: boolean }>;
}): SkillMethods {
  const byTech = new Map<string, TechSkills>();
  const state = (techId: string): TechSkills => {
    let s = byTech.get(techId);
    if (!s) byTech.set(techId, (s = { level: null, submittedAt: null, verified: {}, attempts: [], video: null, certificates: [] }));
    return s;
  };

  const sectionEnds = (e: SkillExam, i: number) => {
    const start = e.sections[i]?.startedAt;
    return start == null ? null : Math.min(start + SECTIONS[i]!.limitSec * 1000, e.endsAt);
  };
  const isOver = (e: SkillExam) => {
    const now = deps.now();
    const last = sectionEnds(e, 2);
    return now > e.endsAt + GRACE_MS || (last !== null && now > last + GRACE_MS);
  };

  function finish(s: TechSkills, a: Attempt, auto: boolean): SkillExam {
    if (a.exam.result) return a.exam;
    let correct = 0;
    let bonus = 0;
    const lastInSection: (number | null)[] = [null, null, null];
    const order = [...a.exam.questions].sort((x, y) => (a.first[x.id] ?? Infinity) - (a.first[y.id] ?? Infinity));
    const taken: Record<string, number | null> = {};
    for (const q of order) {
      const start = a.exam.sections[q.section]?.startedAt ?? null;
      const at = a.first[q.id];
      if (at === undefined || start === null) {
        taken[q.id] = null;
        continue;
      }
      taken[q.id] = at - Math.max(start, lastInSection[q.section] ?? start);
      lastInSection[q.section] = at;
    }
    const questions = a.exam.questions.map((q) => {
      const right = a.exam.answers[q.id] === 'a';
      const fast = right && q.type === 'SELECT' && taken[q.id] !== null && taken[q.id]! <= FAST_MS;
      if (right) correct++;
      if (fast) bonus++;
      return { questionId: q.id, correct: right, fast, points: right ? (fast ? 3 : 2) : 0, changes: a.changes[q.id] ?? 0, secondsTaken: taken[q.id] == null ? null : Math.round(taken[q.id]! / 1000) };
    });
    const passed = correct * 2 >= 12;
    if (passed && !s.verified[a.exam.categoryId]) s.verified[a.exam.categoryId] = 'EXAM';
    a.exam = {
      ...a.exam,
      state: 'SUBMITTED',
      serverNow: deps.now(),
      result: {
        correct, total: 10, points: correct * 2 + bonus, basePoints: correct * 2, bonusPoints: bonus, maxPoints: 24, passPoints: 12, passed,
        autoSubmitted: auto, retakeAt: passed ? null : deps.now() + RETAKE_MS, questions,
      },
    };
    return a.exam;
  }

  async function attempt(token: string, examId: string): Promise<{ s: TechSkills; a: Attempt }> {
    const t = await deps.who(token);
    const s = state(t.id);
    const a = s.attempts.find((x) => x.exam.id === examId);
    if (!a) throw new ApiError('NOT_FOUND');
    if (!a.exam.result && isOver(a.exam)) finish(s, a, true);
    return { s, a };
  }

  async function overview(token: string): Promise<SkillCheck> {
    const t = await deps.who(token);
    const s = state(t.id);
    for (const a of s.attempts) if (!a.exam.result && isOver(a.exam)) finish(s, a, true);
    const now = deps.now();
    return {
      level: s.level,
      required: s.submittedAt === null && t.skills.some((c) => !s.verified[c]),
      submittedAt: s.submittedAt,
      canSubmit: !!s.level && (s.attempts.some((a) => a.exam.result) || (!!s.video && s.video.status !== 'REJECTED')),
      demo: t.demo,
      trades: t.skills.map((c) => {
        const mine = s.attempts.filter((a) => a.exam.categoryId === c);
        const shown = mine.find((a) => a.exam.result?.passed) ?? mine[mine.length - 1];
        const retakeAt = shown?.exam.result && !shown.exam.result.passed ? shown.exam.result.retakeAt : null;
        return {
          categoryId: c,
          verifiedVia: s.verified[c] ?? null,
          verifiedAt: s.verified[c] ? now : null,
          exam: {
            state: !shown ? 'NONE' : !shown.exam.result ? 'IN_PROGRESS' : shown.exam.result.passed ? 'PASSED' : 'FAILED',
            attemptId: shown?.exam.id ?? null,
            points: shown?.exam.result?.points ?? null,
            maxPoints: 24,
            retakeAt: retakeAt !== null && retakeAt > now ? retakeAt : null,
          },
        } as const;
      }),
      video: s.video,
      certificates: [...s.certificates],
      rules: { sections: SECTIONS, passPercent: 60, maxLeftApp: MAX_LEFT_APP, minVideoSec: 60, maxVideoSec: 120, maxCertificates: 4, retakeAfterSec: RETAKE_MS / 1000 },
    };
  }

  const change = async (token: string, examId: string, fn: (s: TechSkills, a: Attempt) => void): Promise<SkillExam> => {
    const { s, a } = await attempt(token, examId);
    if (a.exam.result) throw new ApiError('CONFLICT');
    fn(s, a);
    a.exam = { ...a.exam, serverNow: deps.now() };
    return a.exam;
  };

  return {
    skills: overview,

    async setSkillLevel(token, level) {
      const s = state((await deps.who(token)).id);
      if (s.level !== level && s.attempts.length) throw new ApiError('CONFLICT');
      s.level = level;
      return overview(token);
    },

    async startExam(token, categoryId) {
      const t = await deps.who(token);
      const s = state(t.id);
      if (!s.level) throw new ApiError('CONFLICT');
      if (!t.skills.includes(categoryId)) throw new ApiError('VALIDATION');
      if (s.verified[categoryId]) throw new ApiError('CONFLICT');
      const open = s.attempts.find((a) => !a.exam.result && !isOver(a.exam));
      if (open) {
        if (open.exam.categoryId === categoryId) return open.exam;
        throw new ApiError('CONFLICT');
      }
      const last = [...s.attempts].reverse().find((a) => a.exam.categoryId === categoryId && a.exam.result);
      if (last?.exam.result?.retakeAt && last.exam.result.retakeAt > deps.now()) throw new ApiError('CONFLICT');
      const now = deps.now();
      const exam: SkillExam = {
        id: deps.id('exam'), categoryId, level: s.level, state: 'IN_PROGRESS', serverNow: now, startedAt: now, endsAt: now + 720_000,
        sections: SECTIONS.map((x) => ({ ...x, startedAt: null, endsAt: null })), currentSection: -1, questions: paper(), answers: {},
        leftApp: 0, maxLeftApp: MAX_LEFT_APP, result: null,
      };
      s.attempts.push({ exam, first: {}, changes: {} });
      return exam;
    },

    async exam(token, examId) {
      return (await attempt(token, examId)).a.exam;
    },

    startExamSection: (token, examId, index) =>
      change(token, examId, (_s, a) => {
        if (index === a.exam.currentSection) return;
        if (index !== a.exam.currentSection + 1 || index > 2) throw new ApiError('CONFLICT');
        const now = deps.now();
        const sections = a.exam.sections.map((x, i) => (i === index ? { ...x, startedAt: now, endsAt: Math.min(now + x.limitSec * 1000, a.exam.endsAt) } : x));
        a.exam = { ...a.exam, sections, currentSection: index };
      }),

    answerExam: (token, examId, questionId, optionId) =>
      change(token, examId, (_s, a) => {
        const q = a.exam.questions.find((x) => x.id === questionId);
        if (!q) throw new ApiError('NOT_FOUND');
        if (q.section !== a.exam.currentSection) throw new ApiError('CONFLICT');
        if (deps.now() > (sectionEnds(a.exam, q.section) ?? 0) + GRACE_MS) throw new ApiError('CONFLICT');
        if (!q.options.some((o) => o.id === optionId)) throw new ApiError('VALIDATION');
        const before = a.exam.answers[questionId];
        if (before === optionId) return;
        if (before === undefined) a.first[questionId] = deps.now();
        else a.changes[questionId] = (a.changes[questionId] ?? 0) + 1;
        a.exam = { ...a.exam, answers: { ...a.exam.answers, [questionId]: optionId } };
      }),

    async examLeftApp(token, examId) {
      const { s, a } = await attempt(token, examId);
      if (a.exam.result) return a.exam;
      a.exam = { ...a.exam, leftApp: a.exam.leftApp + 1 };
      return a.exam.leftApp >= MAX_LEFT_APP ? finish(s, a, true) : a.exam;
    },

    async submitExam(token, examId) {
      const { s, a } = await attempt(token, examId);
      return finish(s, a, false);
    },

    async sendSkillVideo(token, input) {
      const t = await deps.who(token);
      if (input.source === 'SAMPLE' && !t.demo) throw new ApiError('VALIDATION');
      state(t.id).video = { id: deps.id('video'), source: input.source, status: 'PENDING', durationSec: input.source === 'SAMPLE' ? null : 90, categoryIds: [], reviewNote: null, createdAt: deps.now() };
      return overview(token);
    },

    async addCertificate(token, input) {
      const t = await deps.who(token);
      const s = state(t.id);
      if ('sample' in input && !t.demo) throw new ApiError('VALIDATION');
      if (s.certificates.filter((c) => c.status !== 'REJECTED').length >= 4) throw new ApiError('CONFLICT');
      s.certificates.push({ id: deps.id('cert'), kind: input.kind, title: input.title, status: 'PENDING', sample: 'sample' in input, reviewNote: null, createdAt: deps.now() });
      return overview(token);
    },

    async removeCertificate(token, certificateId) {
      const s = state((await deps.who(token)).id);
      const cert = s.certificates.find((c) => c.id === certificateId);
      if (!cert) throw new ApiError('NOT_FOUND');
      if (cert.status === 'APPROVED') throw new ApiError('CONFLICT');
      s.certificates = s.certificates.filter((c) => c.id !== certificateId);
      return overview(token);
    },

    async submitSkills(token) {
      const t = await deps.who(token);
      const s = state(t.id);
      const before = await overview(token);
      if (s.submittedAt === null) {
        if (!before.canSubmit) throw new ApiError('CONFLICT');
        s.submittedAt = deps.now();
      }
      return overview(token);
    },
  };
}
