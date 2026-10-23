// The test double's courses: one free course and one advanced course (99 rupees unless the rating is 3.8 or more),
// two short lessons each, a 2-question quiz (the right option is always "a": the double has no shuffle). In memory.
import { ApiError, type TechApi } from '../api';
import type { Course, CourseCard } from '../../domain/types';

type CourseMethods = Pick<TechApi, 'courses' | 'course' | 'enrollCourse' | 'buyCourse' | 'lesson' | 'lessonProgress' | 'courseQuiz' | 'submitCourseQuiz'>;

const DEFS = [
  { id: 'pl-basic', categoryId: 'PLUMBING', level: 'BASIC', price: 0, title: { en: 'Plumbing basics', te: 'ప్లంబింగ్ ప్రాథమికాలు' } },
  { id: 'pl-advanced', categoryId: 'PLUMBING', level: 'ADVANCED', price: 99, title: { en: 'Advanced plumbing', te: 'అడ్వాన్స్‌డ్ ప్లంబింగ్' } },
] as const;
const LESSONS = [{ id: 'one', title: { en: 'Lesson one', te: 'పాఠం ఒకటి' } }, { id: 'two', title: { en: 'Lesson two', te: 'పాఠం రెండు' } }] as const;
const LESSON_SEC = 60;

export function createMockCourses(deps: {
  readonly now: () => number;
  readonly who: (token: string) => Promise<{ readonly id: string; readonly rating: number | null }>;
}): CourseMethods {
  const state = new Map<string, { enrolled: Set<string>; watched: Map<string, number>; completed: Set<string>; attempts: Map<string, number> }>();
  const mine = async (token: string) => {
    const t = await deps.who(token);
    let s = state.get(t.id);
    if (!s) state.set(t.id, (s = { enrolled: new Set(), watched: new Map(), completed: new Set(), attempts: new Map() }));
    return { t, s };
  };
  const def = (id: string) => {
    const d = DEFS.find((x) => x.id === id);
    if (!d) throw new ApiError('NOT_FOUND');
    return d;
  };
  const access = (d: (typeof DEFS)[number], rating: number | null): CourseCard['access'] => (d.level !== 'ADVANCED' ? 'FREE' : rating !== null && rating >= 3.8 ? 'RATING' : 'PAY');

  async function detail(token: string, id: string): Promise<Course> {
    const { t, s } = await mine(token);
    const d = def(id);
    const watched = LESSONS.filter((l) => (s.watched.get(`${id}:${l.id}`) ?? 0) >= LESSON_SEC);
    return {
      id, categoryId: d.categoryId, level: d.level, title: d.title, summary: d.title, lessons: LESSONS.length, durationSec: LESSONS.length * LESSON_SEC,
      price: d.price, access: access(d, t.rating), enrolled: s.enrolled.has(id), completedLessons: watched.length, completed: s.completed.has(id),
      lessonList: LESSONS.map((l) => ({ id: l.id, title: l.title, durationSec: LESSON_SEC, watchedSec: s.watched.get(`${id}:${l.id}`) ?? 0, completed: (s.watched.get(`${id}:${l.id}`) ?? 0) >= LESSON_SEC })),
      quiz: { questions: 2, passCorrect: 2, unlocked: s.enrolled.has(id) && watched.length === LESSONS.length, attempts: s.attempts.get(id) ?? 0, lastCorrect: null },
      certificate: s.completed.has(id) ? { title: `Housefi course: ${d.title.en}`, at: deps.now() } : null,
    };
  }

  const enrolledOnly = async (token: string, id: string) => {
    const { s } = await mine(token);
    def(id);
    if (!s.enrolled.has(id)) throw new ApiError('CONFLICT');
    return s;
  };

  return {
    async courses(token) {
      const { t } = await mine(token);
      return { courses: await Promise.all(DEFS.map((d) => detail(token, d.id))), rating: t.rating, freeFromRating: 3.8, price: 99 };
    },
    course: detail,
    async enrollCourse(token, id) {
      const { t, s } = await mine(token);
      if (access(def(id), t.rating) === 'PAY') throw new ApiError('CONFLICT');
      s.enrolled.add(id);
      return detail(token, id);
    },
    async buyCourse(token, id) {
      const { s } = await mine(token);
      def(id);
      s.enrolled.add(id);
      return detail(token, id);
    },
    async lesson(token, courseId, lessonId) {
      const s = await enrolledOnly(token, courseId);
      const l = LESSONS.find((x) => x.id === lessonId);
      if (!l) throw new ApiError('NOT_FOUND');
      const w = s.watched.get(`${courseId}:${lessonId}`) ?? 0;
      return { id: l.id, title: l.title, url: `https://videos.test/${courseId}/${lessonId}.mp4`, durationSec: LESSON_SEC, watchedSec: w, completed: w >= LESSON_SEC };
    },
    async lessonProgress(token, courseId, lessonId, positionSec) {
      const s = await enrolledOnly(token, courseId);
      const key = `${courseId}:${lessonId}`;
      const w = Math.max(s.watched.get(key) ?? 0, Math.min(LESSON_SEC, Math.floor(positionSec)));
      s.watched.set(key, w);
      return { watchedSec: w, completed: w >= LESSON_SEC };
    },
    async courseQuiz(token, courseId) {
      await enrolledOnly(token, courseId);
      return { questions: [0, 1].map((n) => ({ n, q: { en: `Question ${n + 1}`, te: `ప్రశ్న ${n + 1}` }, options: ['a', 'b', 'c', 'd'].map((id) => ({ id, en: `Option ${id}`, te: `ఎంపిక ${id}` })) })) };
    },
    async submitCourseQuiz(token, courseId, answers) {
      const s = await enrolledOnly(token, courseId);
      s.attempts.set(courseId, (s.attempts.get(courseId) ?? 0) + 1);
      const correct = [0, 1].filter((n) => answers[String(n)] === 'a').length;
      if (correct === 2) s.completed.add(courseId);
      return { correct, total: 2, passed: correct === 2, course: await detail(token, courseId) };
    },
  };
}
