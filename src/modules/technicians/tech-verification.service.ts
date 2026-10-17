import { Injectable } from '@nestjs/common';
import type { ActorType } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { Hashing } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { CATEGORY_ORDER } from './technicians.schemas';

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

  async approve(technicianId: string, actor: VerificationActor): Promise<void> {
    await this.decide(technicianId, actor, 'tech.approve', { verification: 'APPROVED', verifiedAt: new Date(this.clock.now()) });
    // Step 11: notify the technician (PROFILE_APPROVED).
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
    // Step 11: notify the technician (PROFILE_NEEDS_CORRECTION).
  }

  private async decide(
    technicianId: string,
    actor: VerificationActor,
    action: string,
    data: { verification: 'APPROVED' | 'NEEDS_CORRECTION'; verifiedAt?: Date; correctionNoteEn?: string; correctionNoteTe?: string; online?: boolean },
  ): Promise<void> {
    if (!UUID.test(technicianId)) throw new AppError('NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM technicians WHERE user_id = ${technicianId}::uuid FOR UPDATE`;
      const before = await tx.technician.findUnique({ where: { userId: technicianId } });
      if (!before) throw new AppError('NOT_FOUND');
      // Only a submitted, not yet decided profile can be decided: a stale decision must not override a resubmission.
      if (before.verification !== 'PENDING') throw new AppError('CONFLICT', {}, `profile is ${before.verification}, not PENDING`);
      await tx.technician.update({ where: { userId: technicianId }, data });
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
    });
  }
}
