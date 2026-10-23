// Courses for technicians: video lessons HQ uploaded, open across trades. Basic and safety courses are free; an advanced
// course is free with a rating of 3.8 or more, otherwise 99 rupees (Razorpay, the same checkout page as bookings;
// simulated for the team's demo accounts). Lessons count as watched only when watched to (nearly) the end at normal
// speed; after every lesson, a 5-question quiz (3 right to pass, retry any time). A passed quiz completes the course
// and adds a "Housefi course" certification to the profile and ID card.
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { CategoryId, CoursePayment, PaymentMethod, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { OBJECT_STORE, type ObjectStore } from '../../common/storage/object-store';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PaymentsService } from '../payments/payments.service';
import { RAZORPAY_CLIENT, type RazorpayClient, type RzpPayment } from '../payments/razorpay.client';
import { verifyCheckoutSignature } from '../payments/razorpay.signatures';
import { COURSES, type CourseDef, courseDef, type CourseLevel, type Localized } from './course-catalog';
import { ADVANCED_PRICE_RUPEES, freeAccess, FREE_FROM_RATING, markQuiz, nextWatched, optionId, QUIZ_PASS_RATIO, quizOrder, watchedEnough } from './course-rules';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RZP_METHODS: Record<string, PaymentMethod> = { upi: 'UPI', card: 'CARD', netbanking: 'NETBANKING' };
/** A course order not paid within a day is given up (the technician can start again). */
const ABANDON_AFTER_MS = 24 * 3_600_000;
const RECHECK_EVERY_MS = 10 * 60_000;

/** openapi.yaml CourseCard. */
export interface CourseCardDto {
  readonly id: string;
  readonly categoryId: CategoryId | null;
  readonly level: CourseLevel;
  readonly title: Localized;
  readonly summary: Localized;
  readonly lessons: number;
  readonly durationSec: number;
  /** Whole rupees; 0 for basic and safety courses. */
  readonly price: number;
  /** For this technician: FREE (basic, safety), RATING (advanced, free with 3.8★), PAY (advanced, 99 rupees). */
  readonly access: 'FREE' | 'RATING' | 'PAY';
  readonly enrolled: boolean;
  readonly completedLessons: number;
  readonly completed: boolean;
}

/** openapi.yaml Course. */
export interface CourseDto extends CourseCardDto {
  readonly lessonList: readonly { readonly id: string; readonly title: Localized; readonly durationSec: number; readonly watchedSec: number; readonly completed: boolean }[];
  readonly quiz: { readonly questions: number; readonly passCorrect: number; readonly unlocked: boolean; readonly attempts: number; readonly lastCorrect: number | null };
  /** The certification it earned. */
  readonly certificate: { readonly title: string; readonly at: number } | null;
}

export interface CoursesDto {
  readonly courses: readonly CourseCardDto[];
  readonly rating: number | null;
  readonly freeFromRating: number;
  readonly price: number;
}

/** What the app opens the checkout with (as for a booking payment). */
export interface CourseOrderDto {
  readonly paymentId: string;
  readonly provider: 'RAZORPAY' | 'SIMULATED';
  readonly orderId: string;
  readonly keyId: string;
  readonly amount: number;
}

export interface LessonDto {
  readonly id: string;
  readonly title: Localized;
  /** Signed link to the video, valid a little longer than the video. */
  readonly url: string;
  readonly durationSec: number;
  readonly watchedSec: number;
  readonly completed: boolean;
}

export interface QuizDto {
  readonly questions: readonly { readonly n: number; readonly q: Localized; readonly options: readonly { readonly id: string; readonly en: string; readonly te: string }[] }[];
}

export interface QuizResultDto {
  readonly correct: number;
  readonly total: number;
  readonly passed: boolean;
  readonly course: CourseDto;
}

interface OpenCourse {
  readonly def: CourseDef;
  readonly videos: ReadonlyMap<string, { readonly durationSec: number; readonly videoKey: string }>;
  readonly durationSec: number;
}

@Injectable()
export class CoursesService implements OnModuleInit {
  private readonly log = new Logger(CoursesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    @Inject(RAZORPAY_CLIENT) private readonly razorpay: RazorpayClient | null,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    // Razorpay's webhook for a course order (the booking payments do not know it).
    this.payments.registerOrderHandler((rp) => this.settleOrder(rp));
  }

  // ---------- what the technician sees ----------

  async overview(userId: string): Promise<CoursesDto> {
    const t = await this.technician(userId);
    const open = await this.openCourses();
    const [enrolments, progress] = await Promise.all([
      this.prisma.courseEnrollment.findMany({ where: { technicianId: userId } }),
      this.prisma.lessonProgress.findMany({ where: { technicianId: userId, completedAt: { not: null } }, select: { courseId: true, lessonId: true } }),
    ]);
    const done = new Map<string, Set<string>>();
    for (const p of progress) (done.get(p.courseId) ?? done.set(p.courseId, new Set()).get(p.courseId)!).add(p.lessonId);
    return {
      courses: [...open.values()].map((c) => this.card(c, t.rating, enrolments.find((e) => e.courseId === c.def.id) ?? null, done.get(c.def.id))),
      rating: t.rating,
      freeFromRating: FREE_FROM_RATING,
      price: ADVANCED_PRICE_RUPEES,
    };
  }

  async detail(userId: string, courseId: string): Promise<CourseDto> {
    const t = await this.technician(userId);
    const c = await this.openCourse(courseId);
    const [enrolment, progress, attempts, last] = await Promise.all([
      this.prisma.courseEnrollment.findUnique({ where: { technicianId_courseId: { technicianId: userId, courseId } } }),
      this.prisma.lessonProgress.findMany({ where: { technicianId: userId, courseId } }),
      this.prisma.courseQuizAttempt.count({ where: { technicianId: userId, courseId } }),
      this.prisma.courseQuizAttempt.findFirst({ where: { technicianId: userId, courseId }, orderBy: { submittedAt: 'desc' }, select: { correct: true } }),
    ]);
    const done = new Set(progress.filter((p) => p.completedAt).map((p) => p.lessonId));
    const certificate = enrolment?.certificateId
      ? await this.prisma.skillCertificate.findUnique({ where: { id: enrolment.certificateId }, select: { title: true, createdAt: true } })
      : null;
    return {
      ...this.card(c, t.rating, enrolment, done),
      lessonList: c.def.lessons.map((l) => {
        const p = progress.find((x) => x.lessonId === l.id);
        return { id: l.id, title: l.title, durationSec: c.videos.get(l.id)!.durationSec, watchedSec: p?.watchedSec ?? 0, completed: !!p?.completedAt };
      }),
      quiz: {
        questions: c.def.quiz.length,
        passCorrect: Math.ceil(c.def.quiz.length * QUIZ_PASS_RATIO),
        unlocked: !!enrolment && c.def.lessons.every((l) => done.has(l.id)),
        attempts,
        lastCorrect: last?.correct ?? null,
      },
      certificate: certificate ? { title: certificate.title, at: certificate.createdAt.getTime() } : null,
    };
  }

  /** A free course (or an advanced one with a 3.8★ rating): starts it. A paid one needs startPayment. */
  async enroll(userId: string, courseId: string): Promise<CourseDto> {
    const t = await this.technician(userId);
    const c = await this.openCourse(courseId);
    const access = freeAccess(c.def.level, t.rating);
    if (!access) throw new AppError('CONFLICT', {}, `this course costs ${ADVANCED_PRICE_RUPEES} rupees`);
    await this.prisma.courseEnrollment.upsert({
      where: { technicianId_courseId: { technicianId: userId, courseId } },
      create: { technicianId: userId, courseId, access, startedAt: new Date(this.clock.now()) },
      update: {},
    });
    return this.detail(userId, courseId);
  }

  // ---------- buying an advanced course ----------

  async startPayment(userId: string, courseId: string): Promise<CourseOrderDto> {
    const t = await this.technician(userId);
    const c = await this.openCourse(courseId);
    if (await this.prisma.courseEnrollment.count({ where: { technicianId: userId, courseId } })) throw new AppError('CONFLICT', {}, 'already started');
    if (freeAccess(c.def.level, t.rating)) throw new AppError('CONFLICT', {}, 'this course is free for you');
    const id = randomUUID();
    const amountPaise = BigInt(ADVANCED_PRICE_RUPEES) * 100n;
    const now = new Date(this.clock.now());
    if (t.demo) {
      // The team's demo accounts: a simulated order, never a Razorpay one.
      await this.prisma.coursePayment.create({ data: { id, technicianId: userId, courseId, amountPaise, provider: 'SIMULATED', providerOrderId: `sim_course_${id}`, createdAt: now } });
      return { paymentId: id, provider: 'SIMULATED', orderId: `sim_course_${id}`, keyId: '', amount: ADVANCED_PRICE_RUPEES };
    }
    if (!this.razorpay) throw new AppError('INTERNAL', {}, 'payments not configured');
    let orderId: string;
    try {
      orderId = (await this.razorpay.createOrder({ amountPaise: Number(amountPaise), receipt: `course-${courseId}-${id.slice(0, 8)}`, notes: { coursePaymentId: id, courseId } })).id;
    } catch (err) {
      this.log.error(`Razorpay order failed for course ${courseId} (${(err as Error).message})`);
      throw new AppError('INTERNAL', {}, 'payment provider unavailable');
    }
    await this.prisma.coursePayment.create({ data: { id, technicianId: userId, courseId, amountPaise, provider: 'RAZORPAY', providerOrderId: orderId, createdAt: now } });
    return { paymentId: id, provider: 'RAZORPAY', orderId, keyId: this.config.RAZORPAY_KEY_ID ?? '', amount: ADVANCED_PRICE_RUPEES };
  }

  /** After the checkout returns: the signature is checked and Razorpay asked (the app is never trusted). */
  async verifyPayment(userId: string, courseId: string, paymentId: string, body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }): Promise<CourseDto> {
    const t = await this.technician(userId);
    const p = UUID.test(paymentId) ? await this.prisma.coursePayment.findFirst({ where: { id: paymentId, technicianId: userId, courseId } }) : null;
    if (!p) throw new AppError('NOT_FOUND');
    if (p.state === 'CREATED') {
      if (p.provider === 'SIMULATED') {
        if (!t.demo) throw new AppError('CONFLICT');
        await this.settle(p, { id: `sim_pay_${p.id}`, order_id: p.providerOrderId, amount: Number(p.amountPaise), currency: 'INR', status: 'captured', method: 'upi' });
      } else {
        const secret = this.config.RAZORPAY_KEY_SECRET;
        if (!secret || !this.razorpay) throw new AppError('INTERNAL', {}, 'payments not configured');
        if (body.razorpayOrderId !== p.providerOrderId || !verifyCheckoutSignature(body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature, secret)) {
          throw new AppError('PAYMENT_FAILED', {}, 'signature mismatch');
        }
        let rp: RzpPayment;
        try {
          rp = await this.razorpay.fetchPayment(body.razorpayPaymentId);
        } catch (err) {
          this.log.error(`Razorpay fetch failed for course payment ${p.id} (${(err as Error).message})`);
          throw new AppError('INTERNAL', {}, 'payment provider unavailable');
        }
        if (rp.order_id !== p.providerOrderId) throw new AppError('PAYMENT_FAILED', {}, 'payment belongs to another order');
        if ((await this.settle(p, rp)) === 'FAILED') throw new AppError('PAYMENT_FAILED');
      }
    } else if (p.state === 'FAILED') {
      throw new AppError('PAYMENT_FAILED');
    }
    return this.detail(userId, courseId);
  }

  /** Webhook: a course order's payment. True when the order is a course purchase. */
  async settleOrder(rp: RzpPayment): Promise<boolean> {
    const p = await this.prisma.coursePayment.findUnique({ where: { providerOrderId: rp.order_id } });
    if (!p) return false;
    await this.settle(p, rp);
    return true;
  }

  /** Orders the app never came back from (closed after paying, a late webhook): asked again every 10 minutes. */
  async reconcile(): Promise<number> {
    if (!this.razorpay) return 0;
    const now = this.clock.now();
    const rows = await this.prisma.coursePayment.findMany({
      where: { state: 'CREATED', provider: 'RAZORPAY', createdAt: { lte: new Date(now - RECHECK_EVERY_MS) }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: new Date(now - RECHECK_EVERY_MS) } }] },
      take: 50,
    });
    let settled = 0;
    for (const p of rows) {
      try {
        const rank = { captured: 4, authorized: 3, created: 2, refunded: 1, failed: 1 } as const;
        const best = [...(await this.razorpay.fetchOrderPayments(p.providerOrderId))].sort((a, b) => rank[b.status] - rank[a.status])[0];
        if (best && best.status !== 'created') {
          if ((await this.settle(p, best)) !== 'CREATED') settled++;
        } else if (p.createdAt.getTime() <= now - ABANDON_AFTER_MS) {
          await this.prisma.coursePayment.update({ where: { id: p.id }, data: { state: 'FAILED', settledAt: new Date(now) } });
          settled++;
        }
        await this.prisma.coursePayment.update({ where: { id: p.id }, data: { lastCheckedAt: new Date(now) } });
      } catch (err) {
        this.log.warn(`reconcile failed for course payment ${p.id} (${(err as Error).message})`);
      }
    }
    return settled;
  }

  private async settle(p: CoursePayment, rp0: RzpPayment): Promise<'PAID' | 'FAILED' | 'CREATED'> {
    let rp = rp0;
    if (rp.status === 'authorized' && p.provider === 'RAZORPAY' && this.razorpay) {
      try {
        rp = await this.razorpay.capture(rp.id, rp.amount);
      } catch (err) {
        this.log.warn(`capture failed for course payment ${p.id} (${(err as Error).message}); will retry`);
      }
    }
    const state = rp.status === 'captured' && BigInt(rp.amount) === p.amountPaise ? 'PAID' : rp.status === 'failed' ? 'FAILED' : 'CREATED';
    if (state === 'CREATED') return 'CREATED';
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM course_payments WHERE id = ${p.id}::uuid FOR UPDATE`;
      const row = await tx.coursePayment.findUniqueOrThrow({ where: { id: p.id } });
      if (row.state !== 'CREATED') return row.state;
      const now = new Date(this.clock.now());
      await tx.coursePayment.update({
        where: { id: p.id },
        data: { state, settledAt: now, ...(state === 'PAID' ? { providerPaymentId: rp.id, method: RZP_METHODS[rp.method ?? ''] ?? null } : {}) },
      });
      if (state === 'PAID') {
        await tx.courseEnrollment.upsert({
          where: { technicianId_courseId: { technicianId: p.technicianId, courseId: p.courseId } },
          create: { technicianId: p.technicianId, courseId: p.courseId, access: 'PAID', startedAt: now },
          update: {},
        });
      }
      await this.audit.record({ actorType: 'SYSTEM', actorId: null, action: `course.payment_${state.toLowerCase()}`, entity: 'course_payment', entityId: p.id, after: { courseId: p.courseId, technicianId: p.technicianId } }, tx);
      return state;
    });
  }

  // ---------- lessons ----------

  /** A lesson to watch (the course must be started). Opening it starts the watch clock. */
  async lesson(userId: string, courseId: string, lessonId: string): Promise<LessonDto> {
    const { c, video } = await this.enrolledLesson(userId, courseId, lessonId);
    const now = new Date(this.clock.now());
    const p = await this.prisma.lessonProgress.upsert({
      where: { technicianId_courseId_lessonId: { technicianId: userId, courseId, lessonId } },
      create: { technicianId: userId, courseId, lessonId, watchedSec: 0, lastReportAt: now },
      update: { lastReportAt: now },
    });
    // Valid for the whole video and a pause or two (the player keeps reading it).
    const url = await this.store.presignGet(video.videoKey, Math.max(3600, video.durationSec * 3));
    return { id: lessonId, title: c.def.lessons.find((l) => l.id === lessonId)!.title, url, durationSec: video.durationSec, watchedSec: p.watchedSec, completed: !!p.completedAt };
  }

  /** Where the player is (about every 10 seconds, and on pause or close). */
  async progress(userId: string, courseId: string, lessonId: string, positionSec: number): Promise<{ watchedSec: number; completed: boolean }> {
    const { video } = await this.enrolledLesson(userId, courseId, lessonId);
    return this.prisma.$transaction(async (tx) => {
      const now = this.clock.now();
      const prev = await tx.lessonProgress.findUnique({ where: { technicianId_courseId_lessonId: { technicianId: userId, courseId, lessonId } } });
      const watchedSec = nextWatched(prev?.watchedSec ?? 0, positionSec, prev ? now - prev.lastReportAt.getTime() : 0, video.durationSec);
      const completed = !!prev?.completedAt || watchedEnough(watchedSec, video.durationSec);
      await tx.lessonProgress.upsert({
        where: { technicianId_courseId_lessonId: { technicianId: userId, courseId, lessonId } },
        create: { technicianId: userId, courseId, lessonId, watchedSec, lastReportAt: new Date(now), completedAt: completed ? new Date(now) : null },
        update: { watchedSec, lastReportAt: new Date(now), ...(completed && !prev?.completedAt ? { completedAt: new Date(now) } : {}) },
      });
      return { watchedSec, completed };
    });
  }

  // ---------- the quiz ----------

  async quiz(userId: string, courseId: string): Promise<QuizDto> {
    const { c, attempts } = await this.quizReady(userId, courseId);
    const order = quizOrder(`${userId}:${courseId}:${attempts}`, c.def.quiz.map((q) => q.options.length));
    return {
      questions: c.def.quiz.map((q, i) => ({ n: i, q: q.q, options: order[i]!.map((k, shown) => ({ id: optionId(shown), en: q.options[k]!.en, te: q.options[k]!.te })) })),
    };
  }

  async submitQuiz(userId: string, courseId: string, answers: Readonly<Record<string, string>>): Promise<QuizResultDto> {
    const { c, attempts } = await this.quizReady(userId, courseId);
    const order = quizOrder(`${userId}:${courseId}:${attempts}`, c.def.quiz.map((q) => q.options.length));
    const score = markQuiz(c.def.quiz, order, answers);
    const now = new Date(this.clock.now());
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT technician_id FROM course_enrollments WHERE technician_id = ${userId}::uuid AND course_id = ${courseId} FOR UPDATE`;
      await tx.courseQuizAttempt.create({ data: { technicianId: userId, courseId, answers: answers as Prisma.InputJsonValue, correct: score.correct, passed: score.passed, submittedAt: now } });
      const e = await tx.courseEnrollment.findUniqueOrThrow({ where: { technicianId_courseId: { technicianId: userId, courseId } } });
      if (score.passed && !e.completedAt) {
        // The course's certification: shown on the profile and the ID card like an approved certificate.
        const cert = await tx.skillCertificate.create({
          data: { technicianId: userId, kind: 'HOUSEFI_COURSE', title: `Housefi course: ${c.def.title.en}`, status: 'APPROVED', reviewedAt: now, createdAt: now },
        });
        await tx.courseEnrollment.update({ where: { technicianId_courseId: { technicianId: userId, courseId } }, data: { completedAt: now, certificateId: cert.id } });
        await this.audit.record({ actorType: 'TECHNICIAN', actorId: userId, action: 'tech.course_completed', entity: 'course', entityId: courseId, after: { correct: score.correct } }, tx);
      }
    });
    return { ...score, course: await this.detail(userId, courseId) };
  }

  // ---------- inside ----------

  /** Published courses whose every lesson has its video, in catalogue order. */
  async openCourses(): Promise<Map<string, OpenCourse>> {
    const [published, videos] = await Promise.all([
      this.prisma.coursePublication.findMany({ where: { published: true }, select: { courseId: true } }),
      this.prisma.courseLessonVideo.findMany({ select: { courseId: true, lessonId: true, durationSec: true, videoKey: true } }),
    ]);
    const isPublished = new Set(published.map((p) => p.courseId));
    const open = new Map<string, OpenCourse>();
    for (const def of COURSES) {
      if (!isPublished.has(def.id)) continue;
      const mine = new Map(videos.filter((v) => v.courseId === def.id).map((v) => [v.lessonId, { durationSec: v.durationSec, videoKey: v.videoKey }]));
      if (!def.lessons.every((l) => mine.has(l.id))) continue;
      open.set(def.id, { def, videos: mine, durationSec: [...mine.values()].reduce((n, v) => n + v.durationSec, 0) });
    }
    return open;
  }

  private card(c: OpenCourse, rating: number | null, enrolment: { access: string; completedAt: Date | null } | null, done: ReadonlySet<string> | undefined): CourseCardDto {
    const free = freeAccess(c.def.level, rating);
    return {
      id: c.def.id,
      categoryId: c.def.categoryId,
      level: c.def.level,
      title: c.def.title,
      summary: c.def.summary,
      lessons: c.def.lessons.length,
      durationSec: c.durationSec,
      price: c.def.level === 'ADVANCED' ? ADVANCED_PRICE_RUPEES : 0,
      access: free ?? 'PAY',
      enrolled: !!enrolment,
      completedLessons: c.def.lessons.filter((l) => done?.has(l.id)).length,
      completed: !!enrolment?.completedAt,
    };
  }

  private async openCourse(courseId: string): Promise<OpenCourse> {
    const c = courseDef(courseId) ? (await this.openCourses()).get(courseId) : undefined;
    if (!c) throw new AppError('NOT_FOUND');
    return c;
  }

  private async enrolledLesson(userId: string, courseId: string, lessonId: string) {
    await this.technician(userId);
    const c = await this.openCourse(courseId);
    const video = c.videos.get(lessonId);
    if (!video) throw new AppError('NOT_FOUND');
    if (!(await this.prisma.courseEnrollment.count({ where: { technicianId: userId, courseId } }))) throw new AppError('CONFLICT', {}, 'start the course first');
    return { c, video };
  }

  private async quizReady(userId: string, courseId: string) {
    await this.technician(userId);
    const c = await this.openCourse(courseId);
    if (!(await this.prisma.courseEnrollment.count({ where: { technicianId: userId, courseId } }))) throw new AppError('CONFLICT', {}, 'start the course first');
    const watched = await this.prisma.lessonProgress.count({ where: { technicianId: userId, courseId, completedAt: { not: null }, lessonId: { in: c.def.lessons.map((l) => l.id) } } });
    if (watched < c.def.lessons.length) throw new AppError('CONFLICT', {}, 'watch every lesson first');
    return { c, attempts: await this.prisma.courseQuizAttempt.count({ where: { technicianId: userId, courseId } }) };
  }

  private async technician(userId: string): Promise<{ rating: number | null; demo: boolean }> {
    const t = await this.prisma.technician.findUnique({ where: { userId }, select: { ratingAvg: true, verification: true, user: { select: { isDemo: true, status: true } } } });
    if (!t || t.user.status !== 'ACTIVE') throw new AppError('CONFLICT', {}, 'send your profile first');
    if (t.verification === 'REJECTED' || t.verification === 'SUSPENDED') throw new AppError('NOT_VERIFIED');
    return { rating: t.ratingAvg !== null ? Number(t.ratingAvg) : null, demo: t.user.isDemo };
  }
}
