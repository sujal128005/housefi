// The technician's skill check, after the Aadhaar scan: they choose their level, take a timed exam per trade (the
// server keeps the time, the paper and the score; the app never has the answers), may record a work video for HQ to
// watch, and may add certificates. A trade gets job offers only once verified: a passed exam, a video HQ approved, or
// HQ itself (TechnicianSkill.verifiedAt). The review window starts when the skill check is sent (review-window.ts).
import { Injectable } from '@nestjs/common';
import { type CategoryId, Prisma, type SkillExamAttempt, type SkillLevel } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { TechVerificationService } from '../technicians/tech-verification.service';
import { CATEGORY_ORDER } from '../technicians/technicians.schemas';
import { UploadsService } from '../uploads/uploads.service';
import {
  type Answer, BAND_FOR_LEVEL, GRACE_MS, mark, MAX_LEFT_APP, MAX_POINTS, PASS_BASE_POINTS, QUESTIONS_PER_PAPER, type QuestionType, RETAKE_AFTER_MS, SECTIONS,
  sectionOf,
} from './exam-rules';
import { type PaperQuestion, QuestionBank } from './question-bank';
import type { SkillCertificateInput, SkillVideoInput } from './skills.schemas';

/** A work video: at least a minute (a little less is fine: recorders trim) and at most 2 (the upload check allows a few seconds over). */
export const MIN_VIDEO_SEC = 55;
export const MAX_CERTIFICATES = 4;
/** The team's demo accounts can try the exam again after a minute (real accounts: a day). */
const DEMO_RETAKE_AFTER_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TradeVerifiedBy = 'EXAM' | 'VIDEO' | 'HQ' | 'EARLIER';

/** openapi.yaml SkillCheck. */
export interface SkillCheckDto {
  readonly level: SkillLevel | null;
  /** True while the technician still has to send the skill check (a trade not verified and nothing sent yet). */
  readonly required: boolean;
  readonly submittedAt: number | null;
  /** At least one exam taken or a video sent, and the level chosen. */
  readonly canSubmit: boolean;
  /** The team's demo accounts may use a sample video and certificate (the exam is the real one). */
  readonly demo: boolean;
  readonly trades: readonly TradeSkillDto[];
  readonly video: SkillVideoDto | null;
  readonly certificates: readonly CertificateDto[];
  readonly rules: {
    readonly sections: readonly { readonly type: QuestionType; readonly count: number; readonly limitSec: number }[];
    readonly passPercent: number;
    readonly maxLeftApp: number;
    readonly minVideoSec: number;
    readonly maxVideoSec: number;
    readonly maxCertificates: number;
    readonly retakeAfterSec: number;
  };
}

export interface TradeSkillDto {
  readonly categoryId: CategoryId;
  readonly verifiedVia: TradeVerifiedBy | null;
  readonly verifiedAt: number | null;
  readonly exam: {
    readonly state: 'NONE' | 'IN_PROGRESS' | 'PASSED' | 'FAILED';
    readonly attemptId: string | null;
    readonly points: number | null;
    readonly maxPoints: number;
    /** After a failed exam: when it can be taken again (ms), null when it can be taken now. */
    readonly retakeAt: number | null;
  };
}

export interface SkillVideoDto {
  readonly id: string;
  readonly source: 'LIVE' | 'UPLOAD' | 'SAMPLE';
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly durationSec: number | null;
  readonly categoryIds: readonly CategoryId[];
  readonly reviewNote: string | null;
  readonly createdAt: number;
}

export interface CertificateDto {
  readonly id: string;
  readonly kind: 'ITI' | 'SKILL_INDIA' | 'OTHER';
  readonly title: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly sample: boolean;
  readonly reviewNote: string | null;
  readonly createdAt: number;
}

/** openapi.yaml SkillExam. */
export interface ExamDto {
  readonly id: string;
  readonly categoryId: CategoryId;
  readonly level: SkillLevel;
  readonly state: 'IN_PROGRESS' | 'SUBMITTED';
  /** The server's clock (ms), so the app shows the time left right even when the phone's clock is off. */
  readonly serverNow: number;
  readonly startedAt: number;
  /** The paper must be finished by then (ms): every section run to its limit, back to back. */
  readonly endsAt: number;
  readonly sections: readonly { readonly type: QuestionType; readonly count: number; readonly limitSec: number; readonly startedAt: number | null; readonly endsAt: number | null }[];
  /** The open section (-1 before the first is opened). Opening a section closes the one before it. */
  readonly currentSection: number;
  readonly questions: readonly PaperQuestion[];
  /** The technician's answers so far: question id → option id. */
  readonly answers: Readonly<Record<string, string>>;
  readonly leftApp: number;
  readonly maxLeftApp: number;
  readonly result: ExamResultDto | null;
}

export interface ExamResultDto {
  readonly correct: number;
  readonly total: number;
  readonly points: number;
  readonly basePoints: number;
  readonly bonusPoints: number;
  readonly maxPoints: number;
  readonly passPoints: number;
  readonly passed: boolean;
  readonly autoSubmitted: boolean;
  readonly retakeAt: number | null;
  /** Right or wrong per question (not which option was right: the bank is reused for retakes). */
  readonly questions: readonly { readonly questionId: string; readonly correct: boolean; readonly fast: boolean; readonly points: number; readonly changes: number; readonly secondsTaken: number | null }[];
}

type Answers = Record<string, Answer>;

@Injectable()
export class SkillsService {
  readonly bank = QuestionBank.load();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    private readonly verification: TechVerificationService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  // ---------- the technician's overview ----------

  async overview(userId: string): Promise<SkillCheckDto> {
    const t = await this.technician(userId);
    const [attempts, video, certificates] = await Promise.all([
      this.prisma.skillExamAttempt.findMany({ where: { technicianId: userId }, orderBy: { startedAt: 'desc' } }),
      this.prisma.skillVideo.findFirst({ where: { technicianId: userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.skillCertificate.findMany({ where: { technicianId: userId }, orderBy: { createdAt: 'asc' } }),
    ]);
    // An attempt whose time ran out is marked now (the app may have been closed).
    for (const a of attempts) if (!a.submittedAt && this.isOver(a)) Object.assign(a, await this.finish(a.id, true));
    const now = this.clock.now();
    const trades = [...t.skills]
      .sort((a, b) => CATEGORY_ORDER.indexOf(a.categoryId) - CATEGORY_ORDER.indexOf(b.categoryId))
      .map((s): TradeSkillDto => {
        const latest = attempts.find((a) => a.categoryId === s.categoryId);
        const passed = attempts.find((a) => a.categoryId === s.categoryId && a.passed);
        const shown = passed ?? latest;
        const retakeAt = !passed && latest?.submittedAt ? latest.submittedAt.getTime() + this.retakeAfter(t.user.isDemo) : null;
        return {
          categoryId: s.categoryId,
          verifiedVia: s.verifiedVia,
          verifiedAt: s.verifiedAt?.getTime() ?? null,
          exam: {
            state: !shown ? 'NONE' : !shown.submittedAt ? 'IN_PROGRESS' : shown.passed ? 'PASSED' : 'FAILED',
            attemptId: shown?.id ?? null,
            points: shown?.submittedAt ? (shown.basePoints ?? 0) + (shown.bonusPoints ?? 0) : null,
            maxPoints: MAX_POINTS,
            retakeAt: retakeAt !== null && retakeAt > now ? retakeAt : null,
          },
        };
      });
    const taken = attempts.some((a) => a.submittedAt);
    const videoSent = !!video && video.status !== 'REJECTED';
    return {
      level: t.skillLevel,
      required: !t.skillSubmittedAt && t.skills.some((s) => !s.verifiedAt),
      submittedAt: t.skillSubmittedAt?.getTime() ?? null,
      canSubmit: !!t.skillLevel && (taken || videoSent),
      demo: t.user.isDemo,
      trades,
      video: video
        ? { id: video.id, source: video.source, status: video.status, durationSec: video.durationSec, categoryIds: video.categoryIds, reviewNote: video.reviewNote, createdAt: video.createdAt.getTime() }
        : null,
      certificates: certificates.map((c) => ({ id: c.id, kind: c.kind, title: c.title, status: c.status, sample: c.sample, reviewNote: c.reviewNote, createdAt: c.createdAt.getTime() })),
      rules: {
        sections: SECTIONS.map((s) => ({ type: s.type, count: s.count, limitSec: s.limitSec })),
        passPercent: 60,
        maxLeftApp: MAX_LEFT_APP,
        minVideoSec: 60,
        maxVideoSec: 120,
        maxCertificates: MAX_CERTIFICATES,
        retakeAfterSec: this.retakeAfter(t.user.isDemo) / 1000,
      },
    };
  }

  /** The level sets how hard the exam is, so it can be changed only before the first exam is started. */
  async setLevel(userId: string, level: SkillLevel): Promise<SkillCheckDto> {
    const t = await this.technician(userId);
    if (t.skillLevel !== level) {
      if (await this.prisma.skillExamAttempt.count({ where: { technicianId: userId } })) throw new AppError('CONFLICT', {}, 'the level cannot change after an exam was started');
      await this.prisma.technician.update({ where: { userId }, data: { skillLevel: level } });
      await this.audit.record({ actorType: 'TECHNICIAN', actorId: userId, action: 'tech.skill_level', entity: 'technician', entityId: userId, before: { level: t.skillLevel }, after: { level } });
    }
    return this.overview(userId);
  }

  // ---------- the exam ----------

  /**
   * A new paper for one of the technician's trades (or the one still running for it). One exam at a time; after a
   * failed one, the next after RETAKE_AFTER_MS; none for a trade already verified.
   */
  async startExam(userId: string, categoryId: CategoryId): Promise<ExamDto> {
    const t = await this.technician(userId);
    if (!t.skillLevel) throw new AppError('CONFLICT', {}, 'choose your level first');
    const trade = t.skills.find((s) => s.categoryId === categoryId);
    if (!trade) throw new AppError('VALIDATION', { fields: { categoryId: 'INVALID' } }, 'not one of your trades');
    if (trade.verifiedAt) throw new AppError('CONFLICT', {}, 'this trade is already verified');
    const level = t.skillLevel;
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM technicians WHERE user_id = ${userId}::uuid FOR UPDATE`;
      const open = await tx.skillExamAttempt.findFirst({ where: { technicianId: userId, submittedAt: null }, orderBy: { startedAt: 'desc' } });
      if (open && !this.isOver(open)) {
        if (open.categoryId === categoryId) return open.id;
        throw new AppError('CONFLICT', {}, 'finish the exam you started first');
      }
      if (open) await this.finishIn(tx, open, true);
      const last = await tx.skillExamAttempt.findFirst({ where: { technicianId: userId, categoryId, submittedAt: { not: null } }, orderBy: { submittedAt: 'desc' } });
      if (last?.passed) throw new AppError('CONFLICT', {}, 'already passed');
      const wait = last?.submittedAt ? last.submittedAt.getTime() + this.retakeAfter(t.user.isDemo) - this.clock.now() : 0;
      if (wait > 0) throw new AppError('CONFLICT', { retryAfterSec: Math.ceil(wait / 1000) }, 'the exam can be taken again later');
      const a = await tx.skillExamAttempt.create({
        data: {
          technicianId: userId,
          categoryId,
          level,
          questionIds: this.bank.paper(categoryId, BAND_FOR_LEVEL[level]),
          sectionStarts: SECTIONS.map(() => null),
          answers: {},
          startedAt: new Date(this.clock.now()),
        },
      });
      await this.audit.record({ actorType: 'TECHNICIAN', actorId: userId, action: 'tech.skill_exam_started', entity: 'skill_exam', entityId: a.id, after: { categoryId, level } }, tx);
      return a.id;
    });
    return this.exam(userId, id);
  }

  async exam(userId: string, attemptId: string): Promise<ExamDto> {
    let a = await this.attempt(userId, attemptId);
    if (!a.submittedAt && this.isOver(a)) a = await this.finish(a.id, true);
    return this.examDto(a);
  }

  /** Opens the next section (they go in order); the one before closes. */
  async startSection(userId: string, attemptId: string, index: number): Promise<ExamDto> {
    return this.change(userId, attemptId, async (tx, a) => {
      const starts = this.starts(a);
      const current = this.currentSection(starts);
      if (index === current) return;
      if (index !== current + 1 || index >= SECTIONS.length) throw new AppError('CONFLICT', {}, 'sections open in order');
      starts[index] = this.clock.now();
      await tx.skillExamAttempt.update({ where: { id: a.id }, data: { sectionStarts: starts } });
    });
  }

  /** An answer, or a changed one (each change is counted). Only in the open section, and only while its time runs. */
  async answer(userId: string, attemptId: string, questionId: string, optionId: string): Promise<ExamDto> {
    return this.change(userId, attemptId, async (tx, a) => {
      const index = a.questionIds.indexOf(questionId);
      if (index < 0) throw new AppError('NOT_FOUND', {}, 'not on this paper');
      const section = sectionOf(index);
      const starts = this.starts(a);
      if (section !== this.currentSection(starts)) throw new AppError('CONFLICT', {}, 'this section is not open');
      const now = this.clock.now();
      if (now > this.sectionEndsAt(a, starts, section)! + GRACE_MS) throw new AppError('CONFLICT', {}, 'time is up for this section');
      const q = this.bank.question(questionId);
      if (optionId.charCodeAt(0) - 97 >= q.options.length) throw new AppError('VALIDATION', { fields: { optionId: 'INVALID' } });
      const answers = this.answers(a);
      const before = answers[questionId];
      if (before?.option === optionId) return;
      answers[questionId] = before ? { ...before, option: optionId, lastAt: now, changes: before.changes + 1 } : { option: optionId, firstAt: now, lastAt: now, changes: 0 };
      await tx.skillExamAttempt.update({ where: { id: a.id }, data: { answers: answers as unknown as Prisma.InputJsonValue } });
    });
  }

  /** The app was left during the exam (another app, the home screen). The third time submits the paper. */
  async leftApp(userId: string, attemptId: string): Promise<ExamDto> {
    let finished = false;
    const dto = await this.change(userId, attemptId, async (tx, a) => {
      const leftApp = a.leftApp + 1;
      await tx.skillExamAttempt.update({ where: { id: a.id }, data: { leftApp } });
      if (leftApp >= MAX_LEFT_APP) {
        await this.finishIn(tx, { ...a, leftApp }, true);
        finished = true;
      }
    });
    if (finished) await this.afterExam(userId);
    return dto;
  }

  async submitExam(userId: string, attemptId: string): Promise<ExamDto> {
    const a = await this.attempt(userId, attemptId);
    if (a.submittedAt) return this.examDto(a);
    return this.examDto(await this.finish(a.id, this.isOver(a)));
  }

  // ---------- video and certificates ----------

  /** A new work video replaces one still waiting or refused (an approved one stays). */
  async addVideo(userId: string, input: SkillVideoInput): Promise<SkillCheckDto> {
    const t = await this.technician(userId);
    if (input.source === 'SAMPLE' && !t.user.isDemo) throw new AppError('VALIDATION', { fields: { source: 'INVALID' } }, 'a real video is needed');
    let uploadId: string | null = null;
    let durationSec: number | null = null;
    if (input.uploadId) {
      const [u] = await this.uploads.ready(userId, [input.uploadId], 'VIDEO', 'uploadId', 'SKILL');
      if ((u!.durationSec ?? 0) < MIN_VIDEO_SEC) throw new AppError('VALIDATION', { fields: { uploadId: 'INVALID' } }, 'the video must be at least 1 minute');
      uploadId = u!.id;
      durationSec = u!.durationSec;
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT user_id FROM technicians WHERE user_id = ${userId}::uuid FOR UPDATE`;
        await tx.skillVideo.deleteMany({ where: { technicianId: userId, status: { in: ['PENDING', 'REJECTED'] } } });
        const v = await tx.skillVideo.create({ data: { technicianId: userId, uploadId, source: input.source, durationSec, createdAt: new Date(this.clock.now()) } });
        await this.audit.record({ actorType: 'TECHNICIAN', actorId: userId, action: 'tech.skill_video_sent', entity: 'skill_video', entityId: v.id, after: { source: input.source, durationSec } }, tx);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('CONFLICT', {}, 'this file is already used');
      throw e;
    }
    return this.overview(userId);
  }

  async addCertificate(userId: string, input: SkillCertificateInput): Promise<SkillCheckDto> {
    const t = await this.technician(userId);
    if (input.sample && !t.user.isDemo) throw new AppError('VALIDATION', { fields: { uploadId: 'REQUIRED' } }, 'a certificate file is needed');
    const uploadId = input.uploadId ? (await this.uploads.ready(userId, [input.uploadId], 'DOCUMENT', 'uploadId', 'SKILL'))[0]!.id : null;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT user_id FROM technicians WHERE user_id = ${userId}::uuid FOR UPDATE`;
        if ((await tx.skillCertificate.count({ where: { technicianId: userId, status: { not: 'REJECTED' } } })) >= MAX_CERTIFICATES) {
          throw new AppError('CONFLICT', {}, `at most ${MAX_CERTIFICATES} certificates`);
        }
        const c = await tx.skillCertificate.create({ data: { technicianId: userId, kind: input.kind, title: input.title, uploadId, sample: input.sample, createdAt: new Date(this.clock.now()) } });
        await this.audit.record({ actorType: 'TECHNICIAN', actorId: userId, action: 'tech.certificate_added', entity: 'skill_certificate', entityId: c.id, after: { kind: input.kind } }, tx);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('CONFLICT', {}, 'this file is already used');
      throw e;
    }
    return this.overview(userId);
  }

  async removeCertificate(userId: string, id: string): Promise<SkillCheckDto> {
    await this.technician(userId);
    const gone = UUID.test(id) ? await this.prisma.skillCertificate.deleteMany({ where: { id, technicianId: userId } }) : { count: 0 };
    if (!gone.count) throw new AppError('NOT_FOUND');
    await this.audit.record({ actorType: 'TECHNICIAN', actorId: userId, action: 'tech.certificate_removed', entity: 'skill_certificate', entityId: id });
    return this.overview(userId);
  }

  /** Sends the skill check for review: the review window starts now. Needs the level and an exam taken or a video. */
  async submit(userId: string): Promise<SkillCheckDto> {
    const before = await this.overview(userId);
    if (before.submittedAt === null) {
      if (!before.canSubmit) throw new AppError('CONFLICT', {}, before.level ? 'take an exam or send a video first' : 'choose your level first');
      await this.prisma.technician.updateMany({ where: { userId, skillSubmittedAt: null }, data: { skillSubmittedAt: new Date(this.clock.now()) } });
      await this.audit.record({ actorType: 'TECHNICIAN', actorId: userId, action: 'tech.skill_check_sent', entity: 'technician', entityId: userId });
      await this.afterExam(userId);
    }
    return this.overview(userId);
  }

  // ---------- inside ----------

  private async change(userId: string, attemptId: string, fn: (tx: Prisma.TransactionClient, a: SkillExamAttempt) => Promise<void>): Promise<ExamDto> {
    await this.attempt(userId, attemptId);
    const over = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM skill_exam_attempts WHERE id = ${attemptId}::uuid FOR UPDATE`;
      const a = await tx.skillExamAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      if (a.submittedAt) throw new AppError('CONFLICT', {}, 'the exam is already submitted');
      if (this.isOver(a)) return true;
      await fn(tx, a);
      return false;
    });
    // Time ran out before this request: the paper is marked as it stands.
    if (over) {
      await this.finish(attemptId, true);
      throw new AppError('CONFLICT', {}, 'time is up');
    }
    return this.examDto(await this.prisma.skillExamAttempt.findUniqueOrThrow({ where: { id: attemptId } }));
  }

  /** Marks the paper (once). A pass verifies the trade; then the profile may be approved automatically. */
  private async finish(attemptId: string, auto: boolean): Promise<SkillExamAttempt> {
    const a = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM skill_exam_attempts WHERE id = ${attemptId}::uuid FOR UPDATE`;
      const row = await tx.skillExamAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      return row.submittedAt ? row : this.finishIn(tx, row, auto);
    });
    await this.afterExam(a.technicianId);
    return a;
  }

  private async finishIn(tx: Prisma.TransactionClient, a: SkillExamAttempt, auto: boolean): Promise<SkillExamAttempt> {
    const score = mark(a.questionIds, (id) => this.bank.answerKey(a.id, id), this.answers(a), this.starts(a));
    const now = new Date(this.clock.now());
    const done = await tx.skillExamAttempt.update({
      where: { id: a.id },
      data: { submittedAt: now, autoSubmitted: auto, correct: score.correct, basePoints: score.basePoints, bonusPoints: score.bonusPoints, passed: score.passed },
    });
    if (score.passed) {
      await tx.technicianSkill.updateMany({ where: { technicianId: a.technicianId, categoryId: a.categoryId, verifiedAt: null }, data: { verifiedAt: now, verifiedVia: 'EXAM' } });
    }
    await this.audit.record(
      {
        actorType: auto ? 'SYSTEM' : 'TECHNICIAN',
        actorId: auto ? null : a.technicianId,
        action: 'tech.skill_exam_marked',
        entity: 'skill_exam',
        entityId: a.id,
        after: { categoryId: a.categoryId, correct: score.correct, points: score.basePoints + score.bonusPoints, passed: score.passed, leftApp: a.leftApp, auto },
      },
      tx,
    );
    return done;
  }

  private async afterExam(technicianId: string): Promise<void> {
    if (this.config.AUTO_APPROVE_TECHNICIANS) await this.verification.approveIfReady(technicianId);
  }

  private async examDto(a: SkillExamAttempt): Promise<ExamDto> {
    const starts = this.starts(a);
    const answers = this.answers(a);
    const demo = (await this.prisma.user.findUnique({ where: { id: a.technicianId }, select: { isDemo: true } }))?.isDemo ?? false;
    const retakeAt = a.submittedAt && !a.passed ? a.submittedAt.getTime() + this.retakeAfter(demo) : null;
    let result: ExamResultDto | null = null;
    if (a.submittedAt) {
      const score = mark(a.questionIds, (id) => this.bank.answerKey(a.id, id), answers, starts);
      result = {
        correct: score.correct,
        total: QUESTIONS_PER_PAPER,
        points: score.basePoints + score.bonusPoints,
        basePoints: score.basePoints,
        bonusPoints: score.bonusPoints,
        maxPoints: MAX_POINTS,
        passPoints: PASS_BASE_POINTS,
        passed: score.passed,
        autoSubmitted: a.autoSubmitted,
        retakeAt,
        questions: score.marked.map((m) => ({ questionId: m.questionId, correct: m.correct, fast: m.fast, points: m.points, changes: m.changes, secondsTaken: m.secondsTaken })),
      };
    }
    return {
      id: a.id,
      categoryId: a.categoryId,
      level: a.level,
      state: a.submittedAt ? 'SUBMITTED' : 'IN_PROGRESS',
      serverNow: this.clock.now(),
      startedAt: a.startedAt.getTime(),
      endsAt: this.paperEnd(a),
      sections: SECTIONS.map((s, i) => ({ type: s.type, count: s.count, limitSec: s.limitSec, startedAt: starts[i] ?? null, endsAt: this.sectionEndsAt(a, starts, i) })),
      currentSection: this.currentSection(starts),
      questions: this.bank.forApp(a.id, a.questionIds),
      answers: Object.fromEntries(Object.entries(answers).map(([id, x]) => [id, x.option])),
      leftApp: a.leftApp,
      maxLeftApp: MAX_LEFT_APP,
      result,
    };
  }

  /** The paper's own end: started plus every section's limit (sections cannot be held back to gain time). */
  private paperEnd(a: SkillExamAttempt): number {
    return a.startedAt.getTime() + SECTIONS.reduce((n, s) => n + s.limitSec * 1000, 0);
  }

  private sectionEndsAt(a: SkillExamAttempt, starts: readonly (number | null)[], i: number): number | null {
    const start = starts[i];
    return start == null ? null : Math.min(start + SECTIONS[i]!.limitSec * 1000, this.paperEnd(a));
  }

  private currentSection(starts: readonly (number | null)[]): number {
    let current = -1;
    starts.forEach((s, i) => {
      if (s != null) current = i;
    });
    return current;
  }

  /** Time is up: the whole paper's, or the last section's. */
  private isOver(a: SkillExamAttempt): boolean {
    const now = this.clock.now();
    if (now > this.paperEnd(a) + GRACE_MS) return true;
    const starts = this.starts(a);
    const last = SECTIONS.length - 1;
    return starts[last] != null && now > this.sectionEndsAt(a, starts, last)! + GRACE_MS;
  }

  private starts(a: SkillExamAttempt): (number | null)[] {
    const raw = Array.isArray(a.sectionStarts) ? (a.sectionStarts as unknown[]) : [];
    return SECTIONS.map((_, i) => (typeof raw[i] === 'number' ? (raw[i] as number) : null));
  }

  private answers(a: SkillExamAttempt): Answers {
    return { ...((a.answers ?? {}) as unknown as Answers) };
  }

  private retakeAfter(demo: boolean): number {
    return demo ? DEMO_RETAKE_AFTER_MS : RETAKE_AFTER_MS;
  }

  private async attempt(userId: string, attemptId: string): Promise<SkillExamAttempt> {
    const a = UUID.test(attemptId) ? await this.prisma.skillExamAttempt.findFirst({ where: { id: attemptId, technicianId: userId } }) : null;
    if (!a) throw new AppError('NOT_FOUND');
    return a;
  }

  private async technician(userId: string) {
    const t = await this.prisma.technician.findUnique({ where: { userId }, include: { skills: true, user: { select: { isDemo: true, status: true } } } });
    if (!t || t.user.status !== 'ACTIVE') throw new AppError('CONFLICT', {}, 'send your profile first');
    if (t.verification === 'REJECTED' || t.verification === 'SUSPENDED') throw new AppError('NOT_VERIFIED');
    return t;
  }
}

