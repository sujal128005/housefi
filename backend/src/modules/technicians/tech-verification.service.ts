import { Injectable } from '@nestjs/common';
import type { ActorType, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { Hashing } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { newVerifyToken, verifyTokenHash } from '../identity/identity-codes';
import { Notifier } from '../notifications/notifier';
import { CATEGORY_ORDER } from './technicians.schemas';
import { reviewBy } from './review-window';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VerificationActor {
  readonly type: Extract<ActorType, 'ADMIN' | 'COORDINATOR'>;
  /** Null for the command line (who ran it is in `via`). */
  readonly id: string | null;
  /** e.g. 'cli:asha'. */
  readonly via: string;
}

export interface PendingTechnician {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly gender: string;
  readonly experienceYears: number;
  readonly skills: readonly string[];
  readonly city: string;
  readonly pincode: string;
  readonly areas: string;
  readonly vehicle: string;
  readonly submittedAt: Date;
  /** When the technician was told they would hear back (review-window.ts). */
  readonly reviewBy: Date;
  readonly techCode: string | null;
  /** Aadhaar Secure QR result: 'not checked', or the last 4 digits and whether the name matches. */
  readonly aadhaar: string;
  readonly photo: 'none' | 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly correction: string | null;
}

/**
 * Manual verification of technician profiles (README §12: "manual approve via a protected endpoint or SQL for
 * now"). Used by the `npm run tech` command line; the admin portal will call the same methods later.
 */
@Injectable()
export class TechVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly hashing: Hashing,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** Profiles waiting for review, oldest first. */
  async pending(): Promise<PendingTechnician[]> {
    const rows = await this.prisma.technician.findMany({
      where: { verification: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      include: { user: true, skills: true },
    });
    return Promise.all(
      rows.map(async (t) => ({
        id: t.userId,
        name: t.user.nameEnc ? await this.cipher.decrypt('users.name', t.user.nameEnc) : '',
        phone: await this.cipher.decrypt('users.phone', t.user.phoneEnc),
        gender: t.gender,
        experienceYears: t.experienceYears,
        skills: t.skills.map((s) => s.categoryId).sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b)),
        city: t.city,
        pincode: t.pincode.trim(),
        areas: t.areas,
        vehicle: t.vehicleEnc.length > 0 ? await this.cipher.decrypt('technicians.vehicle', t.vehicleEnc) : '',
        submittedAt: t.submittedAt,
        reviewBy: new Date(reviewBy(t.submittedAt.getTime())),
        techCode: t.techCode,
        aadhaar: t.aadhaarVerifiedAt ? `xxxx-${t.aadhaarLast4} (${t.aadhaarNameMatch ? 'name matches' : 'NAME DIFFERS'})` : 'not checked',
        photo: t.photoUploadId ? t.photoStatus : 'none',
        correction: t.correctionKind ? `${t.correctionKind}: ${t.correctionNote ?? ''}` : null,
      })),
    );
  }

  /** A technician user id, or their 10-digit phone number. NOT_FOUND when there is no such technician profile. */
  async resolve(idOrPhone: string): Promise<string> {
    let userId: string | null = null;
    if (UUID.test(idOrPhone)) userId = idOrPhone;
    else if (/^[6-9][0-9]{9}$/.test(idOrPhone)) {
      const user = await this.prisma.user.findUnique({ where: { role_phoneHash: { role: 'TECHNICIAN', phoneHash: this.hashing.phone(idOrPhone) } } });
      userId = user?.id ?? null;
    }
    const tech = userId ? await this.prisma.technician.findUnique({ where: { userId }, select: { userId: true } }) : null;
    if (!tech) throw new AppError('NOT_FOUND', {}, 'no technician profile for that id or phone');
    return tech.userId;
  }

  /**
   * Approves a pending profile; its registration photo is approved with it. With AADHAAR_REQUIRED (default), only
   * after a genuine Aadhaar Secure QR was checked and the name on it matches the legal name.
   */
  async approve(technicianId: string, actor: VerificationActor): Promise<{ shownFrom: Date }> {
    if (this.config.AADHAAR_REQUIRED) {
      const t = UUID.test(technicianId) ? await this.prisma.technician.findUnique({ where: { userId: technicianId }, select: { aadhaarVerifiedAt: true, aadhaarNameMatch: true } }) : null;
      if (t && !t.aadhaarVerifiedAt) throw new AppError('CONFLICT', {}, 'Aadhaar not verified yet (the technician scans their Aadhaar QR in the app)');
      if (t && !t.aadhaarNameMatch) throw new AppError('CONFLICT', {}, 'the name on the Aadhaar differs from the legal name: correct the name first (identity name ...)');
    }
    const submittedAt = await this.decide(technicianId, actor, 'tech.approve', { verification: 'APPROVED', verifiedAt: new Date(this.clock.now()), photoStatus: 'APPROVED' });
    // The technician sees it at the review time they were given (review-window.ts), or now if that has passed.
    return { shownFrom: new Date(Math.max(this.clock.now(), reviewBy(submittedAt.getTime()))) };
  }

  /** Withdraws an approval (complaints, fraud): offline at once, no offers, the QR page shows "not active". */
  async suspend(technicianId: string, reason: string, actor: VerificationActor): Promise<void> {
    await this.setStatus(technicianId, 'SUSPENDED', ['APPROVED'], reason, actor, 'tech.suspend');
  }

  /** Refuses a pending profile for good (e.g. a forged identity). */
  async reject(technicianId: string, reason: string, actor: VerificationActor): Promise<void> {
    await this.setStatus(technicianId, 'REJECTED', ['PENDING', 'NEEDS_CORRECTION'], reason, actor, 'tech.reject');
  }

  /** Lifts a suspension: back to APPROVED (they go online themselves). */
  async reinstate(technicianId: string, reason: string, actor: VerificationActor): Promise<void> {
    await this.setStatus(technicianId, 'APPROVED', ['SUSPENDED'], reason, actor, 'tech.reinstate');
  }

  /** Applies a legal-name correction (checked against the identity document). Clears the correction request. */
  async correctName(technicianId: string, name: string, actor: VerificationActor): Promise<void> {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 60 || !/\p{L}/u.test(clean)) throw new AppError('VALIDATION', { fields: { name: 'INVALID' } });
    const legalNameEnc = await this.cipher.encrypt('technicians.legal_name', clean);
    const nameEnc = await this.cipher.encrypt('users.name', clean);
    await this.identityChange(technicianId, actor, 'tech.legal_name_corrected', async (tx) => {
      await tx.technician.update({ where: { userId: technicianId }, data: { legalNameEnc, correctionKind: null, correctionNote: null, correctionAt: null, aadhaarNameMatch: null } });
      await tx.user.update({ where: { id: technicianId }, data: { nameEnc } });
    });
  }

  /** Lets the technician send a new registration photo with their next profile submission. */
  async allowNewPhoto(technicianId: string, actor: VerificationActor): Promise<void> {
    await this.identityChange(technicianId, actor, 'tech.new_photo_allowed', async (tx) => {
      await tx.technician.update({ where: { userId: technicianId }, data: { photoUploadId: null, photoStatus: 'PENDING', correctionKind: null, correctionNote: null, correctionAt: null } });
    });
  }

  /** A new QR token: the old link stops working at once (lost phone, shared screenshot). */
  async reissueQr(technicianId: string, actor: VerificationActor): Promise<void> {
    const token = newVerifyToken();
    const verifyTokenEnc = await this.cipher.encrypt('technicians.verify_token', token);
    await this.identityChange(technicianId, actor, 'tech.qr_reissued', async (tx) => {
      await tx.technician.update({ where: { userId: technicianId }, data: { verifyTokenHash: verifyTokenHash(token), verifyTokenEnc } });
    });
  }

  private async identityChange(technicianId: string, actor: VerificationActor, action: string, change: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
    if (!UUID.test(technicianId)) throw new AppError('NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM technicians WHERE user_id = ${technicianId}::uuid FOR UPDATE`;
      if (!(await tx.technician.findUnique({ where: { userId: technicianId }, select: { userId: true } }))) throw new AppError('NOT_FOUND');
      await change(tx);
      await this.audit.record({ actorType: actor.type, actorId: actor.id, action, entity: 'technician', entityId: technicianId, before: {}, after: { via: actor.via } }, tx);
    });
  }

  private async setStatus(
    technicianId: string,
    to: 'SUSPENDED' | 'REJECTED' | 'APPROVED',
    from: readonly string[],
    reason: string,
    actor: VerificationActor,
    action: string,
  ): Promise<void> {
    if (!UUID.test(technicianId)) throw new AppError('NOT_FOUND');
    const why = reason.trim();
    if (why.length < 3) throw new AppError('VALIDATION', { fields: { reason: 'INVALID' } }, 'give a reason');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM technicians WHERE user_id = ${technicianId}::uuid FOR UPDATE`;
      const before = await tx.technician.findUnique({ where: { userId: technicianId }, select: { verification: true } });
      if (!before) throw new AppError('NOT_FOUND');
      if (!from.includes(before.verification)) throw new AppError('CONFLICT', {}, `profile is ${before.verification}`);
      await tx.technician.update({ where: { userId: technicianId }, data: { verification: to, ...(to !== 'APPROVED' ? { online: false } : {}) } });
      if (to !== 'APPROVED') {
        await tx.jobOffer.updateMany({ where: { technicianId, state: 'OPEN' }, data: { state: 'WITHDRAWN', respondedAt: new Date(this.clock.now()) } });
      }
      // The reason stays in the audit log; the technician hears from their coordinator or support.
      const kind = to === 'SUSPENDED' ? 'PROFILE_SUSPENDED' : to === 'REJECTED' ? 'PROFILE_REJECTED' : 'PROFILE_REINSTATED';
      await this.notifier.enqueue(tx, [{ userId: technicianId, kind, bookingId: null, params: {} }]);
      await this.audit.record(
        { actorType: actor.type, actorId: actor.id, action, entity: 'technician', entityId: technicianId, before: { verification: before.verification }, after: { verification: to, reason: why, via: actor.via } },
        tx,
      );
    });
  }

  /** Back to the technician with a note shown in the app (English and Telugu). They go offline until approved. */
  async requestCorrection(technicianId: string, note: { en: string; te?: string }, actor: VerificationActor): Promise<void> {
    const en = note.en.trim();
    if (en.length < 3) throw new AppError('VALIDATION', { fields: { note: 'INVALID' } }, 'the note needs a few words');
    await this.decide(technicianId, actor, 'tech.request_correction', {
      verification: 'NEEDS_CORRECTION',
      correctionNoteEn: en,
      correctionNoteTe: note.te?.trim() || en,
      online: false,
    });
  }

  private async decide(
    technicianId: string,
    actor: VerificationActor,
    action: string,
    data: { verification: 'APPROVED' | 'NEEDS_CORRECTION'; verifiedAt?: Date; correctionNoteEn?: string; correctionNoteTe?: string; online?: boolean; photoStatus?: 'APPROVED' },
  ): Promise<Date> {
    if (!UUID.test(technicianId)) throw new AppError('NOT_FOUND');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM technicians WHERE user_id = ${technicianId}::uuid FOR UPDATE`;
      const before = await tx.technician.findUnique({ where: { userId: technicianId } });
      if (!before) throw new AppError('NOT_FOUND');
      // Only a submitted, not yet decided profile can be decided: a stale decision must not override a resubmission.
      if (before.verification !== 'PENDING') throw new AppError('CONFLICT', {}, `profile is ${before.verification}, not PENDING`);
      await tx.technician.update({ where: { userId: technicianId }, data });
      // The note itself is read from GET /tech/me; the notification only says there is one.
      await this.notifier.enqueue(tx, [
        // An approval is announced at the review time the technician was given; a correction request at once.
        data.verification === 'APPROVED'
          ? { userId: technicianId, kind: 'PROFILE_APPROVED', bookingId: null, params: {}, at: reviewBy(before.submittedAt.getTime()) }
          : { userId: technicianId, kind: 'PROFILE_NEEDS_CORRECTION', bookingId: null, params: {} },
      ]);
      if (data.online === false) {
        await tx.jobOffer.updateMany({ where: { technicianId, state: 'OPEN' }, data: { state: 'WITHDRAWN', respondedAt: new Date(this.clock.now()) } });
      }
      await this.audit.record(
        {
          actorType: actor.type,
          actorId: actor.id,
          action,
          entity: 'technician',
          entityId: technicianId,
          before: { verification: before.verification, submittedAt: before.submittedAt.toISOString() },
          after: { verification: data.verification, via: actor.via, ...(data.correctionNoteEn ? { note: data.correctionNoteEn } : {}) },
        },
        tx,
      );
      return before.submittedAt;
    });
  }
}
