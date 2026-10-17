import { Injectable, Logger } from '@nestjs/common';
import type { Booking, Prisma, Quote, TicketPriority } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { rupeesToPaise } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { type Actor, BookingCore, SYSTEM } from '../bookings/booking-core';
import { TECH_ACTIVE } from '../bookings/booking-status';
import type { BookingDto } from '../bookings/booking-view';
import type { JobDto } from '../bookings/job-view';
import { approvedQuotes, latestQuote } from '../bookings/quote-view';
import { PaymentsService } from '../payments/payments.service';
import type { QuoteInput } from './jobs.schemas';
import { priceCheck, totals } from './price-check';

/** STATE-MACHINE.md: UNDER_REVIEW quotes are cleared automatically after 2 minutes until reviewers exist (logged). */
export const REVIEW_AUTO_CLEAR_MS = 2 * 60_000;
/** ETA estimate: straight-line distance x road factor at city speed. Replaced by a routing API later. */
const ROAD_FACTOR = 1.4;
const CITY_METRES_PER_MIN = 20_000 / 60; // 20 km/h

const CLOSES_VISIT = { CUSTOMER_UNAVAILABLE: ['ARRIVED'], CANNOT_COMPLETE: ['INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS'] } as const;
const TICKET_PRIORITY: Record<string, TicketPriority> = { UNSAFE: 'URGENT', PAYMENT_PROBLEM: 'HIGH' };

type StartCodeOutcome = { kind: 'ok' } | { kind: 'invalid'; left: number } | { kind: 'locked' };

/**
 * The visit, step by step, as STATE-MACHINE.md "Who may do what" allows: technician actions on their assigned job and
 * the customer's answers to quotes. Every action locks the booking row; anything not allowed is CONFLICT.
 */
@Injectable()
export class JobsService {
  private readonly log = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly core: BookingCore,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  // ---------- the trip ----------

  async startTrip(technicianId: string, id: string): Promise<JobDto> {
    await this.core.mutateAssigned(technicianId, id, async (tx, b) => {
      if (b.status !== 'ASSIGNED') throw new AppError('CONFLICT');
      await this.core.transition(tx, b, 'EN_ROUTE', { etaMin: await this.etaMinutes(tx, b.id, technicianId) }, this.tech(technicianId));
      // Step 11: TECH_ON_THE_WAY to the customer.
      return { changed: true, result: undefined };
    });
    return this.core.getJob(technicianId, id);
  }

  async arrived(technicianId: string, id: string): Promise<JobDto> {
    await this.core.mutateAssigned(technicianId, id, async (tx, b) => {
      if (b.status !== 'EN_ROUTE') throw new AppError('CONFLICT');
      await this.core.transition(tx, b, 'ARRIVED', { etaMin: null }, this.tech(technicianId));
      return { changed: true, result: undefined };
    });
    return this.core.getJob(technicianId, id);
  }

  /**
   * The 4-digit code the customer reads out at the door starts the visit. Wrong codes count (OTP_INVALID with
   * attemptsLeft); after START_CODE_MAX_ATTEMPTS the visit is locked (OTP_LOCKED) and support gets a ticket.
   */
  async verifyStartCode(technicianId: string, id: string, code: string): Promise<JobDto> {
    const max = this.config.START_CODE_MAX_ATTEMPTS;
    // The attempt is committed before answering, so a wrong code always counts.
    const outcome = await this.core.mutateAssigned(technicianId, id, async (tx, b): Promise<{ changed: boolean; result: StartCodeOutcome }> => {
      if (b.status !== 'ARRIVED') throw new AppError('CONFLICT');
      if (b.startCodeAttempts >= max) return { changed: false, result: { kind: 'locked' } };
      const expected = Buffer.from(await this.cipher.decrypt('bookings.arrival_code', b.arrivalCodeEnc));
      const given = Buffer.from(code);
      if (given.length === expected.length && timingSafeEqual(given, expected)) {
        await this.core.transition(tx, b, 'INSPECTING', {}, this.tech(technicianId));
        return { changed: true, result: { kind: 'ok' } };
      }
      const attempts = b.startCodeAttempts + 1;
      await tx.booking.update({ where: { id: b.id }, data: { startCodeAttempts: attempts, version: { increment: 1 } } });
      if (attempts < max) return { changed: true, result: { kind: 'invalid', left: max - attempts } };
      await this.ticket(tx, b.id, technicianId, 'START_CODE_LOCKED', `${max} wrong start codes`, 'HIGH');
      return { changed: true, result: { kind: 'locked' } };
    });
    if (outcome.kind === 'invalid') throw new AppError('OTP_INVALID', { attemptsLeft: outcome.left }, 'wrong start code');
    if (outcome.kind === 'locked') throw new AppError('OTP_LOCKED', {}, 'start code locked; support has been told');
    return this.core.getJob(technicianId, id);
  }

  // ---------- quotes ----------

  /**
   * The repair quote (MAIN: while inspecting, or a new version after the customer asked for a lower price) or extra
   * work during the repair (EXTRA: once work has started, one at a time). The price check decides at once: FAIR is
   * shared with the customer; UNDER_REVIEW waits for review (auto-cleared after 2 minutes for now).
   */
  async submitQuote(technicianId: string, id: string, input: QuoteInput): Promise<JobDto> {
    await this.core.mutateAssigned(technicianId, id, async (tx, b) => {
      const quotes = await tx.quote.findMany({ where: { bookingId: b.id } });
      const previous = latestQuote(quotes, input.which);
      if (input.which === 'MAIN') {
        const first = b.status === 'INSPECTING' && !previous;
        const revision = b.status === 'QUOTE_SHARED' && previous?.decision === 'REVISION_REQUESTED';
        if (!first && !revision) throw new AppError('CONFLICT');
        if (!input.lines.some((l) => l.kind === 'LABOUR')) throw new AppError('VALIDATION', { fields: { lines: 'INVALID' } }, 'a repair quote needs a labour line');
        if (totals(input.lines).totalPaise < rupeesToPaise(this.config.QUOTE_MIN_RUPEES)) {
          throw new AppError('VALIDATION', { fields: { lines: 'INVALID' } }, `minimum ₹${this.config.QUOTE_MIN_RUPEES}`);
        }
      } else {
        const extraOpen = previous && (previous.decision === 'PENDING' || previous.decision === 'APPROVED');
        if (b.status !== 'IN_PROGRESS' || !b.workStarted || extraOpen) throw new AppError('CONFLICT');
      }
      const service = await tx.service.findUniqueOrThrow({ where: { id: b.serviceId } });
      const t = totals(input.lines);
      const review = priceCheck(input.lines, service.repairTypicalMaxPaise);
      if (previous) await tx.quote.update({ where: { id: previous.id }, data: { superseded: true } });
      await tx.quote.create({
        data: {
          bookingId: b.id,
          which: input.which,
          version: (previous?.version ?? 0) + 1,
          diagnosis: input.diagnosis,
          labourPaise: t.labourPaise,
          materialPaise: t.materialPaise,
          totalPaise: t.totalPaise,
          review,
          typicalMinPaise: service.repairFromPaise,
          typicalMaxPaise: service.repairTypicalMaxPaise,
          createdBy: technicianId,
          createdAt: this.core.now(),
          lines: { create: input.lines.map((l, sort) => ({ kind: l.kind, name: l.name, qty: l.qty, unitPaise: rupeesToPaise(l.unitPrice), sort })) },
        },
      });
      if (review === 'FAIR') await this.share(tx, b, input.which, this.tech(technicianId));
      return { changed: true, result: undefined };
    });
    return this.core.getJob(technicianId, id);
  }

  /**
   * The customer's answer. MAIN: APPROVE (repair goes ahead), REVISION (ask for a lower price; the technician sends a
   * new version), DECLINE (visit ends without repair; the ₹49 is kept). EXTRA: APPROVE or DECLINE, then the repair
   * continues either way.
   */
  async answerQuote(customerId: string, id: string, which: 'MAIN' | 'EXTRA', answer: 'APPROVE' | 'REVISION' | 'DECLINE'): Promise<BookingDto> {
    if (which === 'EXTRA' && answer === 'REVISION') throw new AppError('VALIDATION', { fields: { answer: 'INVALID' } }, 'REVISION is for the repair quote only');
    await this.core.mutateOwned(customerId, id, async (tx, b) => {
      const quotes = await tx.quote.findMany({ where: { bookingId: b.id } });
      const q = latestQuote(quotes, which, true);
      const expected = which === 'MAIN' ? 'QUOTE_SHARED' : 'EXTRA_WORK';
      if (b.status !== expected || !q || q.decision !== 'PENDING') throw new AppError('CONFLICT');
      const now = this.core.now();
      const customer = { type: 'CUSTOMER' as const, id: customerId };
      const decision = answer === 'APPROVE' ? 'APPROVED' : answer === 'REVISION' ? 'REVISION_REQUESTED' : 'REJECTED';
      await tx.quote.update({ where: { id: q.id }, data: { decision, decidedAt: now } });
      if (which === 'EXTRA') {
        await this.core.transition(tx, b, 'IN_PROGRESS', {}, customer, { extra: decision });
      } else if (answer === 'APPROVE') {
        await this.core.transition(tx, b, 'IN_PROGRESS', { workStarted: false }, customer, { quoteVersion: q.version });
      } else if (answer === 'DECLINE') {
        await this.core.transition(tx, b, 'CLOSED_NO_REPAIR', { closeReason: 'CUSTOMER_DECLINED' }, customer, { quoteVersion: q.version });
      }
      // REVISION keeps QUOTE_SHARED; the revised quote is recorded when it is shared. Step 11 tells the technician.
      return { changed: true, result: undefined };
    });
    return this.core.get(customerId, id);
  }

  // ---------- the repair ----------

  async startWork(technicianId: string, id: string): Promise<JobDto> {
    await this.core.mutateAssigned(technicianId, id, async (tx, b) => {
      if (b.status !== 'IN_PROGRESS' || b.workStarted) throw new AppError('CONFLICT');
      await tx.booking.update({ where: { id: b.id }, data: { workStarted: true, version: { increment: 1 } } });
      return { changed: true, result: undefined };
    });
    return this.core.getJob(technicianId, id);
  }

  /** Work done: the bill (approved quote + approved extra) is due. Not while extra work waits for the customer. */
  async complete(technicianId: string, id: string): Promise<JobDto> {
    await this.core.mutateAssigned(technicianId, id, async (tx, b) => {
      if (b.status !== 'IN_PROGRESS' || !b.workStarted) throw new AppError('CONFLICT');
      const quotes = await tx.quote.findMany({ where: { bookingId: b.id } });
      if (latestQuote(quotes, 'EXTRA')?.decision === 'PENDING') throw new AppError('CONFLICT', {}, 'extra work is waiting for the customer');
      const amount = approvedQuotes(quotes).reduce((sum, q) => sum + q.totalPaise, 0n);
      await this.payments.createDue(tx, b.id, 'FINAL', amount);
      await this.core.transition(tx, b, 'PAYMENT_DUE', {}, this.tech(technicianId), { billPaise: amount.toString() });
      // Step 11: PAYMENT_DUE to the customer.
      return { changed: true, result: undefined };
    });
    return this.core.getJob(technicianId, id);
  }

  async confirmCash(technicianId: string, id: string): Promise<JobDto> {
    await this.payments.confirmCash(technicianId, id);
    return this.core.getJob(technicianId, id);
  }

  // ---------- reports ----------

  /**
   * CUSTOMER_UNAVAILABLE (at the door) and CANNOT_COMPLETE (inspecting, quote shared, repairing) end the visit
   * without repair; the other issues open a support ticket (UNSAFE: urgent) and leave the job as it is.
   */
  async report(technicianId: string, id: string, issue: string, note: string): Promise<JobDto> {
    await this.core.mutateAssigned(technicianId, id, async (tx, b) => {
      if (issue === 'CUSTOMER_UNAVAILABLE' || issue === 'CANNOT_COMPLETE') {
        if (!(CLOSES_VISIT[issue] as readonly string[]).includes(b.status)) throw new AppError('CONFLICT');
        await this.core.transition(tx, b, 'CLOSED_NO_REPAIR', { closeReason: issue, etaMin: null }, this.tech(technicianId), { report: issue });
        // Notes go to support, not into the booking timeline.
        if (note) await this.ticket(tx, b.id, technicianId, issue, note, 'NORMAL');
        return { changed: true, result: undefined };
      }
      if (!TECH_ACTIVE.includes(b.status)) throw new AppError('CONFLICT');
      await this.ticket(tx, b.id, technicianId, issue, note, TICKET_PRIORITY[issue] ?? 'NORMAL');
      return { changed: false, result: undefined };
    });
    return this.core.getJob(technicianId, id);
  }

  // ---------- system ----------

  /** Clears quotes that have waited 2 minutes in review and shares them (audited). */
  async autoClearReviews(): Promise<number> {
    const before = new Date(this.clock.now() - REVIEW_AUTO_CLEAR_MS);
    const due = await this.prisma.quote.findMany({ where: { review: 'UNDER_REVIEW', superseded: false, createdAt: { lte: before } }, select: { id: true, bookingId: true }, take: 100 });
    let n = 0;
    for (const d of due) {
      const cleared = await this.prisma.$transaction(async (tx) => {
        const b = await this.core.lock(tx, d.bookingId);
        const q = await tx.quote.findUniqueOrThrow({ where: { id: d.id } });
        if (!b || q.review !== 'UNDER_REVIEW' || q.superseded) return false;
        await tx.quote.update({ where: { id: q.id }, data: { review: 'CLEARED', reviewedAt: this.core.now() } });
        await this.audit.record(
          { actorType: 'SYSTEM', actorId: null, action: 'quote.auto_clear', entity: 'quote', entityId: q.id, before: { review: 'UNDER_REVIEW', totalPaise: q.totalPaise.toString() }, after: { review: 'CLEARED', reason: 'no reviewer within 2 minutes' } },
          tx,
        );
        await this.share(tx, b, q.which, SYSTEM);
        return true;
      });
      if (cleared) {
        n++;
        this.core.updates.publish(d.bookingId);
      }
    }
    return n;
  }

  /** While a technician travels, their location updates refresh the customer's ETA. */
  async refreshEta(technicianId: string): Promise<void> {
    const job = await this.prisma.booking.findFirst({ where: { technicianId, status: 'EN_ROUTE' }, select: { id: true, etaMin: true } });
    if (!job) return;
    const eta = await this.etaMinutes(this.prisma, job.id, technicianId);
    if (eta === null || eta === job.etaMin) return;
    await this.prisma.booking.updateMany({ where: { id: job.id, status: 'EN_ROUTE' }, data: { etaMin: eta } });
    this.core.updates.publish(job.id);
  }

  // ---------- internals ----------

  /** A quote that passed the check becomes visible: the booking moves to where the customer answers it. */
  private async share(tx: Prisma.TransactionClient, b: Booking, which: Quote['which'], actor: Actor): Promise<void> {
    if (which === 'MAIN' && (b.status === 'INSPECTING' || b.status === 'QUOTE_SHARED')) await this.core.transition(tx, b, 'QUOTE_SHARED', {}, actor);
    if (which === 'EXTRA' && b.status === 'IN_PROGRESS') await this.core.transition(tx, b, 'EXTRA_WORK', {}, actor);
    // Step 11: QUOTE_READY / EXTRA_QUOTE to the customer.
  }

  private async etaMinutes(db: Prisma.TransactionClient | PrismaService, bookingId: string, technicianId: string): Promise<number | null> {
    const [row] = await db.$queryRaw<{ m: number | null }[]>`
      SELECT ST_Distance(t.last_location, b.location) AS m FROM technicians t, bookings b
      WHERE t.user_id = ${technicianId}::uuid AND b.id = ${bookingId}::uuid`;
    if (row?.m === null || row?.m === undefined) return null;
    return Math.max(1, Math.ceil((row.m * ROAD_FACTOR) / CITY_METRES_PER_MIN));
  }

  private async ticket(tx: Prisma.TransactionClient, bookingId: string, raisedBy: string, kind: string, note: string, priority: TicketPriority): Promise<void> {
    await tx.supportTicket.create({ data: { bookingId, raisedBy, kind, note, priority, createdAt: this.core.now() } });
    if (priority !== 'NORMAL') this.log.warn(`${priority} support ticket: ${kind} on booking ${bookingId}`);
  }

  private tech(id: string) {
    return { type: 'TECHNICIAN' as const, id };
  }
}

