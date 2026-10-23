// HQ's side of the skill check: who is waiting (a work video, a certificate, or a skill check with no trade verified),
// each technician's exams question by question, the video and certificates to watch, and the decisions. Approving a
// video verifies the trades HQ ticks; HQ can also verify a trade itself (e.g. a keypad-phone technician tested in
// person). The profile itself is approved as before (Technicians page), automatically when everything is ready.
import { Injectable } from '@nestjs/common';
import type { CategoryId, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { MediaUrls } from '../../common/storage/object-store';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { TechVerificationService } from '../technicians/tech-verification.service';
import { CATEGORY_ORDER } from '../technicians/technicians.schemas';
import { type Answer, mark, MAX_POINTS, sectionOf } from './exam-rules';
import { SkillsService } from './skills.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReviewActor {
  readonly id: string;
  readonly ip: string;
}

/** A row of HQ's skill check queue. */
export interface SkillQueueRow {
  readonly technicianId: string;
  readonly name: string;
  readonly techCode: string | null;
  readonly verification: string;
  readonly level: string | null;
  readonly submittedAt: number | null;
  readonly demo: boolean;
  readonly trades: readonly { readonly categoryId: CategoryId; readonly verifiedVia: string | null }[];
  readonly exams: readonly { readonly categoryId: CategoryId; readonly points: number; readonly passed: boolean }[];
  readonly videoWaiting: boolean;
  readonly certificatesWaiting: number;
}

export interface SkillDetail extends SkillQueueRow {
  readonly attempts: readonly {
    readonly id: string;
    readonly categoryId: CategoryId;
    readonly level: string;
    readonly startedAt: number;
    readonly submittedAt: number | null;
    readonly autoSubmitted: boolean;
    readonly leftApp: number;
    readonly points: number | null;
    readonly maxPoints: number;
    readonly passed: boolean | null;
    readonly questions: readonly {
      readonly id: string;
      readonly section: number;
      readonly type: string;
      readonly text: string;
      readonly art: string | null;
      readonly chosen: string | null;
      readonly right: string;
      readonly correct: boolean;
      readonly fast: boolean;
      readonly points: number;
      readonly secondsTaken: number | null;
      readonly changes: number;
    }[];
  }[];
  readonly videos: readonly {
    readonly id: string;
    readonly source: string;
    readonly status: string;
    readonly durationSec: number | null;
    /** A short-lived link to watch it; null for a demo sample. */
    readonly url: string | null;
    readonly categoryIds: readonly CategoryId[];
    readonly reviewNote: string | null;
    readonly createdAt: number;
    readonly reviewedAt: number | null;
  }[];
  readonly certificates: readonly {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
    readonly status: string;
    readonly sample: boolean;
    readonly url: string | null;
    readonly contentType: string | null;
    readonly reviewNote: string | null;
    readonly createdAt: number;
  }[];
}

const INCLUDE = {
  user: { select: { nameEnc: true, isDemo: true } },
  skills: true,
  skillExams: { where: { submittedAt: { not: null } }, orderBy: { startedAt: 'desc' } },
  skillVideos: { where: { status: 'PENDING' }, select: { id: true } },
  certificates: { where: { status: 'PENDING' }, select: { id: true } },
} satisfies Prisma.TechnicianInclude;

@Injectable()
export class SkillsReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly audit: AuditService,
    private readonly media: MediaUrls,
    private readonly skills: SkillsService,
    private readonly verification: TechVerificationService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** WAITING: a video or certificate to decide, or a skill check sent with no trade verified yet. ALL: every skill check, newest first. */
  async queue(state: 'WAITING' | 'ALL'): Promise<SkillQueueRow[]> {
    const where: Prisma.TechnicianWhereInput =
      state === 'WAITING'
        ? {
            OR: [
              { skillVideos: { some: { status: 'PENDING' } } },
              { certificates: { some: { status: 'PENDING' } } },
              { skillSubmittedAt: { not: null }, verification: 'PENDING', skills: { none: { verifiedAt: { not: null } } } },
            ],
          }
        : { OR: [{ skillLevel: { not: null } }, { skillVideos: { some: {} } }, { certificates: { some: {} } }] };
    const rows = await this.prisma.technician.findMany({ where, include: INCLUDE, orderBy: [{ skillSubmittedAt: { sort: 'asc', nulls: 'last' } }, { submittedAt: 'asc' }], take: 200 });
    return Promise.all(rows.map((t) => this.row(t)));
  }

  async detail(technicianId: string): Promise<SkillDetail> {
    const t = UUID.test(technicianId) ? await this.prisma.technician.findUnique({ where: { userId: technicianId }, include: INCLUDE }) : null;
    if (!t) throw new AppError('NOT_FOUND');
    const [attempts, videos, certificates] = await Promise.all([
      this.prisma.skillExamAttempt.findMany({ where: { technicianId }, orderBy: { startedAt: 'desc' }, take: 20 }),
      this.prisma.skillVideo.findMany({ where: { technicianId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.skillCertificate.findMany({ where: { technicianId }, orderBy: { createdAt: 'desc' }, include: { upload: { select: { contentType: true } } } }),
    ]);
    const bank = this.skills.bank;
    const optionText = (attemptId: string, questionId: string, optionId: string | undefined): string | null => {
      if (!optionId) return null;
      const o = bank.option(attemptId, questionId, optionId);
      return o ? (bank.question(questionId).type === 'DIAGRAM' ? (o.art ?? '').replace('label.', '') : `${o.en ?? ''}${o.art ? ` (${o.art})` : ''}`) : null;
    };
    return {
      ...(await this.row(t)),
      attempts: attempts.map((a) => {
        const answers = (a.answers ?? {}) as unknown as Record<string, Answer>;
        const starts = (Array.isArray(a.sectionStarts) ? a.sectionStarts : []) as (number | null)[];
        const score = mark(a.questionIds, (id) => bank.answerKey(a.id, id), answers, starts);
        return {
          id: a.id,
          categoryId: a.categoryId,
          level: a.level,
          startedAt: a.startedAt.getTime(),
          submittedAt: a.submittedAt?.getTime() ?? null,
          autoSubmitted: a.autoSubmitted,
          leftApp: a.leftApp,
          points: a.submittedAt ? (a.basePoints ?? 0) + (a.bonusPoints ?? 0) : null,
          maxPoints: MAX_POINTS,
          passed: a.passed,
          questions: a.questionIds.map((id, i) => {
            const q = bank.question(id);
            const m = score.marked[i]!;
            return {
              id,
              section: sectionOf(i),
              type: q.type,
              text: q.q.en,
              art: q.art ?? null,
              chosen: optionText(a.id, id, answers[id]?.option),
              right: optionText(a.id, id, bank.answerKey(a.id, id))!,
              correct: m.correct,
              fast: m.fast,
              points: m.points,
              secondsTaken: m.secondsTaken,
              changes: m.changes,
            };
          }),
        };
      }),
      videos: await Promise.all(
        videos.map(async (v) => ({
          id: v.id,
          source: v.source,
          status: v.status,
          durationSec: v.durationSec,
          url: v.uploadId ? await this.media.fileUrl(v.uploadId) : null,
          categoryIds: v.categoryIds,
          reviewNote: v.reviewNote,
          createdAt: v.createdAt.getTime(),
          reviewedAt: v.reviewedAt?.getTime() ?? null,
        })),
      ),
      certificates: await Promise.all(
        certificates.map(async (c) => ({
          id: c.id,
          kind: c.kind,
          title: c.title,
          status: c.status,
          sample: c.sample,
          url: c.uploadId ? await this.media.fileUrl(c.uploadId) : null,
          contentType: c.upload?.contentType ?? null,
          reviewNote: c.reviewNote,
          createdAt: c.createdAt.getTime(),
        })),
      ),
    };
  }

  /** Approve (the trades it shows get verified) or refuse a work video waiting for review. */
  async decideVideo(videoId: string, decision: 'APPROVE' | 'REJECT', categoryIds: readonly CategoryId[], note: string, by: ReviewActor): Promise<void> {
    if (!UUID.test(videoId)) throw new AppError('NOT_FOUND');
    const technicianId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM skill_videos WHERE id = ${videoId}::uuid FOR UPDATE`;
      const v = await tx.skillVideo.findUnique({ where: { id: videoId }, include: { technician: { include: { skills: true } } } });
      if (!v) throw new AppError('NOT_FOUND');
      if (v.status !== 'PENDING') throw new AppError('CONFLICT', {}, `already ${v.status.toLowerCase()}`);
      const own = new Set(v.technician.skills.map((s) => s.categoryId));
      const trades = [...new Set(categoryIds)];
      if (decision === 'APPROVE' && trades.some((c) => !own.has(c))) throw new AppError('VALIDATION', { fields: { categoryIds: 'INVALID' } }, 'only the technician\'s own trades');
      const now = new Date(this.clock.now());
      await tx.skillVideo.update({
        where: { id: videoId },
        data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', categoryIds: decision === 'APPROVE' ? trades : [], reviewNote: note || null, reviewedById: by.id, reviewedAt: now },
      });
      if (decision === 'APPROVE') {
        await tx.technicianSkill.updateMany({ where: { technicianId: v.technicianId, categoryId: { in: trades }, verifiedAt: null }, data: { verifiedAt: now, verifiedVia: 'VIDEO' } });
      }
      await this.audit.record(
        { actorType: 'ADMIN', actorId: by.id, action: `admin.skill_video_${decision.toLowerCase()}`, entity: 'skill_video', entityId: videoId, after: { technicianId: v.technicianId, trades, note }, ip: by.ip },
        tx,
      );
      return v.technicianId;
    });
    await this.maybeApprove(technicianId);
  }

  /** Approve (shown as a certification on the profile and ID page) or refuse a certificate. */
  async decideCertificate(certificateId: string, decision: 'APPROVE' | 'REJECT', note: string, by: ReviewActor): Promise<void> {
    if (!UUID.test(certificateId)) throw new AppError('NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM skill_certificates WHERE id = ${certificateId}::uuid FOR UPDATE`;
      const c = await tx.skillCertificate.findUnique({ where: { id: certificateId } });
      if (!c) throw new AppError('NOT_FOUND');
      if (c.status !== 'PENDING') throw new AppError('CONFLICT', {}, `already ${c.status.toLowerCase()}`);
      await tx.skillCertificate.update({
        where: { id: certificateId },
        data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewNote: note || null, reviewedById: by.id, reviewedAt: new Date(this.clock.now()) },
      });
      await this.audit.record(
        { actorType: 'ADMIN', actorId: by.id, action: `admin.certificate_${decision.toLowerCase()}`, entity: 'skill_certificate', entityId: certificateId, after: { technicianId: c.technicianId, note }, ip: by.ip },
        tx,
      );
    });
  }

  /** HQ verifies one of the technician's trades itself, or withdraws a verification (no more offers for it). */
  async decideTrade(technicianId: string, categoryId: CategoryId, verified: boolean, note: string, by: ReviewActor): Promise<void> {
    if (!UUID.test(technicianId)) throw new AppError('NOT_FOUND');
    const trade = await this.prisma.technicianSkill.findUnique({ where: { technicianId_categoryId: { technicianId, categoryId } } });
    if (!trade) throw new AppError('VALIDATION', { fields: { categoryId: 'INVALID' } }, 'not one of the technician\'s trades');
    const now = new Date(this.clock.now());
    await this.prisma.$transaction(async (tx) => {
      await tx.technicianSkill.update({
        where: { technicianId_categoryId: { technicianId, categoryId } },
        data: verified ? { verifiedAt: trade.verifiedAt ?? now, verifiedVia: trade.verifiedVia ?? 'HQ' } : { verifiedAt: null, verifiedVia: null },
      });
      // A trade withdrawn: its open job offers go to someone else.
      if (!verified) {
        await tx.jobOffer.updateMany({ where: { technicianId, state: 'OPEN', booking: { categoryId } }, data: { state: 'WITHDRAWN', respondedAt: now } });
      }
      await this.audit.record(
        { actorType: 'ADMIN', actorId: by.id, action: verified ? 'admin.trade_verified' : 'admin.trade_unverified', entity: 'technician', entityId: technicianId, after: { categoryId, note }, ip: by.ip },
        tx,
      );
    });
    if (verified) await this.maybeApprove(technicianId);
  }

  private async maybeApprove(technicianId: string): Promise<void> {
    if (this.config.AUTO_APPROVE_TECHNICIANS) await this.verification.approveIfReady(technicianId);
  }

  private async row(t: Prisma.TechnicianGetPayload<{ include: typeof INCLUDE }>): Promise<SkillQueueRow> {
    const passedOrLatest = new Map<CategoryId, { points: number; passed: boolean }>();
    for (const a of t.skillExams) {
      const prev = passedOrLatest.get(a.categoryId);
      if (!prev || (!prev.passed && a.passed)) passedOrLatest.set(a.categoryId, { points: (a.basePoints ?? 0) + (a.bonusPoints ?? 0), passed: !!a.passed });
    }
    return {
      technicianId: t.userId,
      name: t.user.nameEnc ? await this.cipher.decrypt('users.name', t.user.nameEnc) : '',
      techCode: t.techCode,
      verification: t.verification,
      level: t.skillLevel,
      submittedAt: t.skillSubmittedAt?.getTime() ?? null,
      demo: t.user.isDemo,
      trades: [...t.skills]
        .sort((a, b) => CATEGORY_ORDER.indexOf(a.categoryId) - CATEGORY_ORDER.indexOf(b.categoryId))
        .map((s) => ({ categoryId: s.categoryId, verifiedVia: s.verifiedVia })),
      exams: [...passedOrLatest].map(([categoryId, e]) => ({ categoryId, ...e })),
      videoWaiting: t.skillVideos.length > 0,
      certificatesWaiting: t.certificates.length,
    };
  }
}
