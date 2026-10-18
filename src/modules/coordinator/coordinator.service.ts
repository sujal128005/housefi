import { Injectable } from '@nestjs/common';
import type { Booking, BookingStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { actingFor } from '../bookings/acting-for';
import { type Actor, BookingCore, UUID } from '../bookings/booking-core';
import { TECH_ACTIVE } from '../bookings/booking-status';
import type { JobDto } from '../bookings/job-view';
import { DispatchService } from '../dispatch/dispatch.service';
import { QuoteInput, ReportBody, StartCodeBody } from '../jobs/jobs.schemas';
import { JobsService } from '../jobs/jobs.service';

export const COORDINATOR_ACTIONS = ['start-trip', 'arrived', 'verify-start-code', 'quotes', 'start-work', 'complete', 'confirm-cash', 'reports'] as const;
export type CoordinatorAction = (typeof COORDINATOR_ACTIONS)[number];

const ASSIGNABLE: readonly BookingStatus[] = ['MATCHING', 'MATCHING_DELAYED'];
/** A queue claim older than this lapses: another coordinator may take the booking. */
export const CLAIM_LAPSES_MS = 15 * 60_000;

/** A booking still looking for a technician, as a coordinator sees it: the area, never the address or the customer. */
export interface SearchingJobDto {
  readonly id: string;
  readonly code: string;
  readonly serviceId: string;
  readonly categoryId: Booking['categoryId'];
  readonly status: BookingStatus;
  readonly area: string;
  readonly pincode: string;
  readonly time: { readonly mode: 'INSTANT'; readonly window: null } | { readonly mode: 'SCHEDULED'; readonly window: { date: string; startHour: number; endHour: number } };
  readonly searchingSince: number | null;
}

export interface QueueEntryDto {
  readonly bookingId: string;
  readonly code: string;
  readonly serviceId: string;
  readonly categoryId: string;
  readonly area: string;
  readonly pincode: string;
  readonly reason: string;
  readonly enteredAt: number;
  readonly claimedBy: string | null;
  readonly claimedAt: number | null;
}

export interface OfferHistoryDto {
  readonly offerId: string;
  readonly technicianId: string;
  readonly channel: string;
  readonly state: string;
  readonly createdAt: number;
  readonly respondedAt: number | null;
  readonly calls: readonly { readonly state: string; readonly keypad: string | null; readonly requestedAt: number; readonly durationS: number | null }[];
}

export interface CoordinatorJobsDto {
  readonly searching: readonly SearchingJobDto[];
  /** Active jobs of the technicians linked to this coordinator, as those technicians would see them. */
  readonly assigned: readonly JobDto[];
}

/**
 * Coordinator-assisted jobs (README §9) for technicians without a smartphone, who are linked to a coordinator. A
 * coordinator can assign a searching booking to one of their technicians, and do the technician's job actions for
 * them. Everything is recorded with actorType COORDINATOR (timeline and audit_log).
 */
@Injectable()
export class CoordinatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: BookingCore,
    private readonly dispatch: DispatchService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** A team demo coordinator sees only demo bookings; everyone else only real ones. */
  private async isDemo(coordinatorId: string): Promise<boolean> {
    return (await this.prisma.user.findUnique({ where: { id: coordinatorId }, select: { isDemo: true } }))?.isDemo ?? false;
  }

  async list(coordinatorId: string): Promise<CoordinatorJobsDto> {
    const isDemo = await this.isDemo(coordinatorId);
    const searching = await this.prisma.booking.findMany({ where: { status: { in: [...ASSIGNABLE] }, isDemo }, orderBy: { matchingStartedAt: 'asc' }, take: 100 });
    const techs = await this.prisma.technician.findMany({ where: { coordinatorId }, select: { userId: true } });
    const assigned = (await Promise.all(techs.map((t) => this.core.listJobs(t.userId, 'active')))).flat();
    return {
      searching: searching.map((b) => ({
        id: b.id,
        code: b.code,
        serviceId: b.serviceId,
        categoryId: b.categoryId,
        status: b.status,
        area: b.locality && b.locality !== b.city ? `${b.locality}, ${b.city}` : b.city,
        pincode: b.pincode.trim(),
        time:
          b.timeMode === 'SCHEDULED' && b.windowDate && b.windowStartHour !== null && b.windowEndHour !== null
            ? { mode: 'SCHEDULED', window: { date: b.windowDate.toISOString().slice(0, 10), startHour: b.windowStartHour, endHour: b.windowEndHour } }
            : { mode: 'INSTANT', window: null },
        searchingSince: b.matchingStartedAt?.getTime() ?? null,
      })),
      assigned,
    };
  }

  // ---------- manual queue (no app or phone technician took the booking) ----------

  /** Open queue entries, oldest first, with who is handling each. Demo bookings only for demo coordinators. */
  async queue(coordinatorId: string): Promise<QueueEntryDto[]> {
    const isDemo = await this.isDemo(coordinatorId);
    const rows = await this.prisma.dispatchQueueEntry.findMany({
      where: { resolvedAt: null, booking: { status: { in: [...ASSIGNABLE] }, isDemo } },
      orderBy: { enteredAt: 'asc' },
      include: { booking: true },
      take: 100,
    });
    return rows.map((q) => ({
      bookingId: q.bookingId,
      code: q.booking.code,
      serviceId: q.booking.serviceId,
      categoryId: q.booking.categoryId,
      area: q.booking.locality && q.booking.locality !== q.booking.city ? `${q.booking.locality}, ${q.booking.city}` : q.booking.city,
      pincode: q.booking.pincode.trim(),
      reason: q.reason,
      enteredAt: q.enteredAt.getTime(),
      claimedBy: q.claimedBy,
      claimedAt: q.claimedAt?.getTime() ?? null,
    }));
  }

  /** One coordinator at a time handles an entry: CONFLICT when another holds it (claims older than 15 minutes lapse). */
  async claim(coordinatorId: string, bookingId: string): Promise<void> {
    if (!UUID.test(bookingId)) throw new AppError('NOT_FOUND');
    const now = new Date(this.clock.now());
    const stale = new Date(now.getTime() - CLAIM_LAPSES_MS);
    const r = await this.prisma.dispatchQueueEntry.updateMany({
      where: { bookingId, resolvedAt: null, OR: [{ claimedBy: null }, { claimedBy: coordinatorId }, { claimedAt: { lt: stale } }] },
      data: { claimedBy: coordinatorId, claimedAt: now },
    });
    if (r.count === 0) {
      const exists = await this.prisma.dispatchQueueEntry.findFirst({ where: { bookingId, resolvedAt: null }, select: { bookingId: true } });
      throw exists ? new AppError('CONFLICT', {}, 'another coordinator is handling it') : new AppError('NOT_FOUND');
    }
  }

  async release(coordinatorId: string, bookingId: string): Promise<void> {
    if (!UUID.test(bookingId)) throw new AppError('NOT_FOUND');
    await this.prisma.dispatchQueueEntry.updateMany({ where: { bookingId, claimedBy: coordinatorId, resolvedAt: null }, data: { claimedBy: null, claimedAt: null } });
  }

  /**
   * The offers made for a booking, with every phone call and its outcome (no phone numbers). Only for a booking in
   * the manual queue, or one assigned to this coordinator's technician; NOT_FOUND otherwise.
   */
  async offers(coordinatorId: string, bookingId: string): Promise<OfferHistoryDto[]> {
    if (!UUID.test(bookingId)) throw new AppError('NOT_FOUND');
    const isDemo = await this.isDemo(coordinatorId);
    const visible = await this.prisma.booking.count({
      where: { id: bookingId, isDemo, OR: [{ queueEntry: { is: { resolvedAt: null } } }, { technician: { is: { coordinatorId } } }] },
    });
    if (visible === 0) throw new AppError('NOT_FOUND');
    const rows = await this.prisma.jobOffer.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' }, include: { callAttempts: { orderBy: { requestedAt: 'asc' } } } });
    return rows.map((o) => ({
      offerId: o.id,
      technicianId: o.technicianId,
      channel: o.channel,
      state: o.state,
      createdAt: o.createdAt.getTime(),
      respondedAt: o.respondedAt?.getTime() ?? null,
      calls: o.callAttempts.map((c) => ({ state: c.state, keypad: c.keypadResult, requestedAt: c.requestedAt.getTime(), durationS: c.durationS })),
    }));
  }

  /** Gives a searching booking to one of this coordinator's technicians (approved, with the skill, not busy). */
  async assign(coordinatorId: string, bookingId: string, technicianId: string): Promise<JobDto> {
    if (!UUID.test(bookingId) || !UUID.test(technicianId)) throw new AppError('NOT_FOUND');
    const actor: Actor = { type: 'COORDINATOR', id: coordinatorId };
    await this.prisma.$transaction(async (tx) => {
      const b = await this.core.lock(tx, bookingId);
      if (!b) throw new AppError('NOT_FOUND');
      await tx.$queryRaw`SELECT user_id FROM technicians WHERE user_id = ${technicianId}::uuid FOR UPDATE`;
      const tech = await tx.technician.findFirst({ where: { userId: technicianId, coordinatorId }, include: { skills: true, user: { select: { isDemo: true, status: true } } } });
      if (!tech || tech.user.status !== 'ACTIVE') throw new AppError('NOT_FOUND', {}, 'not one of your technicians');
      // Demo bookings only to demo technicians and the other way round.
      if (tech.user.isDemo !== b.isDemo) throw new AppError('CONFLICT', {}, 'demo and real bookings and technicians are kept apart');
      if (tech.verification !== 'APPROVED') throw new AppError('NOT_VERIFIED');
      if (!tech.skills.some((s) => s.categoryId === b.categoryId)) throw new AppError('CONFLICT', {}, `technician has no ${b.categoryId} skill`);
      if ((await tx.booking.count({ where: { technicianId, status: { in: [...TECH_ACTIVE] } } })) > 0) throw new AppError('CONFLICT', {}, 'technician is on another job');
      if (!ASSIGNABLE.includes(b.status)) throw new AppError('CONFLICT', {}, `booking is ${b.status}`);
      // A queue entry another coordinator is handling (claimed in the last 15 minutes) is theirs to assign.
      const claimedByOther = await tx.dispatchQueueEntry.count({
        where: { bookingId: b.id, resolvedAt: null, claimedBy: { not: coordinatorId }, claimedAt: { gte: new Date(this.clock.now() - CLAIM_LAPSES_MS) } },
      });
      if (claimedByOther > 0) throw new AppError('CONFLICT', {}, 'another coordinator is handling it');
      await this.dispatch.withdrawOpen(tx, b.id);
      const now = new Date(this.clock.now());
      await this.core.transition(tx, b, 'ASSIGNED', { technician: { connect: { userId: technicianId } }, assignedAt: now }, actor, { assignedBy: 'COORDINATOR' });
      await tx.dispatchQueueEntry.updateMany({ where: { bookingId: b.id, resolvedAt: null }, data: { resolvedAt: now } });
      await this.audit.record(
        { actorType: 'COORDINATOR', actorId: coordinatorId, action: 'coordinator.assign', entity: 'booking', entityId: b.id, before: { status: b.status }, after: { status: 'ASSIGNED', technicianId } },
        tx,
      );
    });
    this.core.updates.publish(bookingId);
    return this.core.getJob(technicianId, bookingId);
  }

  /**
   * Does a technician action for the coordinator's technician on this job, with the same body and rules as the
   * technician's own endpoint. Every attempt is audited with its outcome (a wrong start code counts too).
   */
  async act(coordinatorId: string, bookingId: string, action: string, body: unknown): Promise<JobDto> {
    if (!UUID.test(bookingId)) throw new AppError('NOT_FOUND');
    if (!(COORDINATOR_ACTIONS as readonly string[]).includes(action)) throw new AppError('NOT_FOUND');
    const job = await this.prisma.booking.findFirst({ where: { id: bookingId, technician: { coordinatorId } }, select: { technicianId: true } });
    if (!job?.technicianId) throw new AppError('NOT_FOUND');
    const technicianId = job.technicianId;
    const run = (): Promise<JobDto> => {
      switch (action as CoordinatorAction) {
        case 'start-trip':
          return this.jobs.startTrip(technicianId, bookingId);
        case 'arrived':
          return this.jobs.arrived(technicianId, bookingId);
        case 'verify-start-code':
          return this.jobs.verifyStartCode(technicianId, bookingId, new ZodValidationPipe(StartCodeBody).transform(body).code);
        case 'quotes':
          return this.jobs.submitQuote(technicianId, bookingId, new ZodValidationPipe(QuoteInput).transform(body));
        case 'start-work':
          return this.jobs.startWork(technicianId, bookingId);
        case 'complete':
          return this.jobs.complete(technicianId, bookingId);
        case 'confirm-cash':
          return this.jobs.confirmCash(technicianId, bookingId);
        case 'reports': {
          const r = new ZodValidationPipe(ReportBody).transform(body);
          return this.jobs.report(technicianId, bookingId, r.issue, r.note);
        }
      }
    };
    let outcome = 'OK';
    try {
      return await actingFor({ type: 'COORDINATOR', id: coordinatorId }, run);
    } catch (err) {
      outcome = err instanceof AppError ? err.code : 'ERROR';
      throw err;
    } finally {
      await this.audit.record({ actorType: 'COORDINATOR', actorId: coordinatorId, action: `coordinator.${action}`, entity: 'booking', entityId: bookingId, after: { technicianId, outcome } });
    }
  }
}
