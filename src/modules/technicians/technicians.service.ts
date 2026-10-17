import { Injectable } from '@nestjs/common';
import type { Prisma, Technician, TechnicianSkill, User } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { TECH_ACTIVE } from '../bookings/booking-status';
import { CATEGORY_ORDER, type TechProfileInput } from './technicians.schemas';

type Db = Prisma.TransactionClient | PrismaService;
export type TechnicianRow = Technician & { skills: TechnicianSkill[] };

/** openapi.yaml TechProfile. Before the first submission the fields are empty and `verification` is null. */
export interface TechProfileDto {
  readonly id: string;
  readonly phone: string;
  readonly name: string;
  readonly gender: 'M' | 'F';
  readonly experienceYears: number;
  readonly skills: readonly string[];
  readonly city: string;
  readonly pincode: string;
  readonly areas: string;
  readonly vehicle: string;
  readonly phoneType: 'SMARTPHONE' | 'KEYPAD' | 'NONE';
  readonly verification: 'PENDING' | 'APPROVED' | 'NEEDS_CORRECTION' | null;
  readonly correctionNote: { readonly en: string; readonly te: string } | null;
  readonly online: boolean;
  readonly rating: number | null;
  readonly jobsDone: number;
}

const byCategoryOrder = (a: string, b: string) => CATEGORY_ORDER.indexOf(a as never) - CATEGORY_ORDER.indexOf(b as never);

@Injectable()
export class TechniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly audit: AuditService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** The profile as the technician app shows it (also used in the sign-in response). */
  async profileOf(user: User, tech?: TechnicianRow | null): Promise<TechProfileDto> {
    const row = tech === undefined ? await this.find(this.prisma, user.id) : tech;
    const phone = await this.cipher.decrypt('users.phone', user.phoneEnc);
    const name = user.nameEnc ? await this.cipher.decrypt('users.name', user.nameEnc) : '';
    if (!row) {
      // Not submitted yet (docs/QUESTIONS.md #17: the contract has no shape for an empty profile).
      return {
        id: user.id, phone, name, gender: 'M', experienceYears: 0, skills: [], city: '', pincode: '', areas: '', vehicle: '',
        phoneType: 'SMARTPHONE', verification: null, correctionNote: null, online: false, rating: null, jobsDone: 0,
      };
    }
    return {
      id: user.id,
      phone,
      name,
      gender: row.gender,
      experienceYears: row.experienceYears,
      skills: row.skills.map((s) => s.categoryId).sort(byCategoryOrder),
      city: row.city,
      pincode: row.pincode.trim(),
      areas: row.areas,
      vehicle: row.vehicleEnc.length > 0 ? await this.cipher.decrypt('technicians.vehicle', row.vehicleEnc) : '',
      phoneType: row.phoneType,
      verification: row.verification,
      correctionNote: row.correctionNoteEn !== null ? { en: row.correctionNoteEn, te: row.correctionNoteTe ?? row.correctionNoteEn } : null,
      online: row.online,
      rating: row.ratingAvg !== null ? Number(row.ratingAvg) : null,
      jobsDone: row.jobsDone,
    };
  }

  async me(userId: string): Promise<TechProfileDto> {
    return this.profileOf(await this.user(userId));
  }

  /**
   * First submission or a correction: saves the profile and puts it (back) into verification. An approved technician
   * who edits goes back to PENDING and offline until reviewed again. Not while on a job.
   */
  async submit(userId: string, input: TechProfileInput): Promise<TechProfileDto> {
    const user = await this.user(userId);
    const vehicleEnc = input.vehicle ? await this.cipher.encrypt('technicians.vehicle', input.vehicle) : new Uint8Array(0);
    const nameEnc = await this.cipher.encrypt('users.name', input.name);
    const now = new Date(this.clock.now());
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (await this.hasActiveJob(tx, userId)) throw new AppError('CONFLICT', {}, 'finish the current job first');
      const before = await tx.technician.findUnique({ where: { userId }, select: { verification: true } });
      const fields = {
        gender: input.gender,
        experienceYears: input.experienceYears,
        city: input.city,
        pincode: input.pincode,
        areas: input.areas,
        vehicleEnc,
        verification: 'PENDING' as const,
        correctionNoteEn: null,
        correctionNoteTe: null,
        online: false,
        submittedAt: now,
        verifiedAt: null,
      };
      await tx.technician.upsert({ where: { userId }, create: { userId, ...fields }, update: fields });
      await tx.technicianSkill.deleteMany({ where: { technicianId: userId } });
      await tx.technicianSkill.createMany({ data: input.skills.map((categoryId) => ({ technicianId: userId, categoryId })) });
      await tx.user.update({ where: { id: userId }, data: { nameEnc } });
      await this.clearLocation(tx, userId);
      await this.withdrawOffers(tx, userId);
      await this.audit.record(
        { actorType: 'TECHNICIAN', actorId: userId, action: 'tech.profile_submitted', entity: 'technician', entityId: userId, before: { verification: before?.verification ?? null }, after: { verification: 'PENDING', skills: input.skills } },
        tx,
      );
    });
    return this.profileOf(await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }));
  }

  /** Online = ready for job offers. Only APPROVED technicians may go online (else NOT_VERIFIED). */
  async setOnline(userId: string, online: boolean): Promise<TechProfileDto> {
    const user = await this.user(userId);
    const tech = await this.find(this.prisma, userId);
    if (online) {
      if (!tech || tech.verification !== 'APPROVED') throw new AppError('NOT_VERIFIED');
      await this.prisma.technician.update({ where: { userId }, data: { online: true, missedOffersInRow: 0 } });
    } else if (tech) {
      await this.prisma.$transaction(async (tx) => {
        await tx.technician.update({ where: { userId }, data: { online: false } });
        await this.withdrawOffers(tx, userId);
        // Nobody is tracked while offline (a technician on a job keeps sending location regardless).
        if (!(await this.hasActiveJob(tx, userId))) await this.clearLocation(tx, userId);
      });
    }
    return this.profileOf(user);
  }

  /**
   * The phone's position every ~60 s. Stored only while online or on a job (latest point only, no history);
   * otherwise accepted and dropped. Customers never see it before the trip starts (step 9).
   */
  async updateLocation(userId: string, lat: number, lng: number, accuracy: number | undefined): Promise<void> {
    await this.user(userId);
    const tech = await this.prisma.technician.findUnique({ where: { userId }, select: { online: true } });
    if (!tech) return;
    if (!tech.online && !(await this.hasActiveJob(this.prisma, userId))) return;
    const at = new Date(this.clock.now());
    const acc = accuracy === undefined ? null : Math.round(accuracy);
    await this.prisma.$executeRaw`
      UPDATE technicians SET last_location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        last_location_at = ${at}, last_accuracy_m = ${acc}
      WHERE user_id = ${userId}::uuid`;
  }

  /** Account deletion (inside the caller's transaction): CONFLICT while on a job; otherwise offline and wiped. */
  async anonymiseForDeletion(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    if (await this.hasActiveJob(tx, userId)) throw new AppError('CONFLICT', {}, 'a job is still in progress');
    const exists = await tx.technician.findUnique({ where: { userId }, select: { userId: true } });
    if (!exists) return;
    await tx.technician.update({ where: { userId }, data: { online: false, vehicleEnc: new Uint8Array(0), areas: '' } });
    await this.clearLocation(tx, userId);
  }

  async hasActiveJob(db: Db, technicianId: string): Promise<boolean> {
    return (await db.booking.count({ where: { technicianId, status: { in: [...TECH_ACTIVE] } } })) > 0;
  }

  find(db: Db, userId: string): Promise<TechnicianRow | null> {
    return db.technician.findUnique({ where: { userId }, include: { skills: true } });
  }

  /** An unavailable technician's open offer is withdrawn (not a miss); dispatch offers the job to someone else. */
  private async withdrawOffers(db: Db, userId: string): Promise<void> {
    await db.jobOffer.updateMany({ where: { technicianId: userId, state: 'OPEN' }, data: { state: 'WITHDRAWN', respondedAt: new Date(this.clock.now()) } });
  }

  private async clearLocation(db: Db, userId: string): Promise<void> {
    await db.$executeRaw`UPDATE technicians SET last_location = NULL, last_location_at = NULL, last_accuracy_m = NULL WHERE user_id = ${userId}::uuid`;
  }

  private async user(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE' || user.role !== 'TECHNICIAN') throw new AppError('UNAUTHENTICATED');
    return user;
  }
}
