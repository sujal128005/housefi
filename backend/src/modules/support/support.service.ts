import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type TicketPriority, type UserRole } from '@prisma/client';
import { Hashing } from '../../common/crypto/hashing';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { ACTIVE_STATUSES } from '../bookings/booking-status';
import { type Position, positionColumns } from './support.schemas';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TicketKind = 'UNSAFE' | 'PAYMENT_PROBLEM' | 'OTHER';

/** README §5: the SOS "alert team" is urgent; a payment problem (the v1 dispute flow, README §10) is high. */
export const TICKET_PRIORITY: Readonly<Record<TicketKind, TicketPriority>> = { UNSAFE: 'URGENT', PAYMENT_PROBLEM: 'HIGH', OTHER: 'NORMAL' };

export interface Raiser {
  readonly id: string;
  readonly role: UserRole;
}

export interface SupportActor {
  readonly type: 'ADMIN' | 'COORDINATOR';
  /** Null for the command line (who ran it is in `via`). */
  readonly id: string | null;
  readonly via: string;
}

export interface TicketRow {
  readonly id: string;
  readonly kind: string;
  readonly priority: TicketPriority;
  readonly state: string;
  readonly bookingCode: string | null;
  readonly raisedByRole: UserRole;
  readonly note: string;
  readonly createdAt: Date;
}

/** Customer and technician tickets (SOS, payment problems, other) and call-back requests (README §5 Help / Safety). */
@Injectable()
export class SupportService {
  private readonly log = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly hashing: Hashing,
    @InjectClock() private readonly clock: Clock,
    @InjectConfig() private readonly config: Env,
  ) {}

  /**
   * Lifts a sign-in lock on a number (after wrong codes), once support has confirmed with the person that it is
   * really them, e.g. on a call to the number. Audited. Returns false when the number was not locked.
   */
  async unlockSignIn(phone: string, actor: SupportActor): Promise<boolean> {
    const digits = phone.replace(/^(\+?91)/, '');
    if (!/^[6-9][0-9]{9}$/.test(digits)) throw new AppError('VALIDATION', { fields: { phone: 'INVALID' } }, 'a 10-digit mobile number');
    const phoneHash = this.hashing.phone(digits);
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.otpLockout.findUnique({ where: { phoneHash } });
      if (!lock) return false;
      await tx.otpLockout.delete({ where: { phoneHash } });
      await this.audit.record(
        {
          actorType: actor.type, actorId: actor.id, action: 'support.unlock_sign_in', entity: 'phone', entityId: Buffer.from(phoneHash).toString('hex').slice(0, 16),
          before: { level: lock.level, lockedUntil: lock.lockedUntil?.toISOString() ?? null }, after: { level: 0, via: actor.via, phone: `******${digits.slice(-4)}` },
        },
        tx,
      );
      return true;
    });
  }

  /**
   * Gives the technician fresh start-code tries after START_CODE_MAX_ATTEMPTS wrong ones locked the visit, once
   * support has checked with the customer and the technician (e.g. on a call) that they are really together at the
   * door. Only an ARRIVED booking that is locked; resolves its open START_CODE_LOCKED ticket. Audited.
   * `ref` is the booking code ("HF-48291", or just the digits) or its id.
   */
  async unlockStartCode(ref: string, actor: SupportActor): Promise<{ code: string; ticketsResolved: number }> {
    const where = UUID.test(ref.trim()) ? { id: ref.trim() } : { code: `HF-${ref.trim().toUpperCase().replace(/^HF-?/, '')}` };
    if (!('id' in where) && !/^HF-\d{5,6}$/.test(where.code)) throw new AppError('NOT_FOUND', {}, 'no booking with that code');
    const max = this.config.START_CODE_MAX_ATTEMPTS;
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.booking.findUnique({ where, select: { id: true } });
      if (!found) throw new AppError('NOT_FOUND', {}, 'no booking with that code');
      // Lock the row so a start-code attempt at the same moment cannot interleave.
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${found.id}::uuid FOR UPDATE`;
      const b = await tx.booking.findUniqueOrThrow({ where: { id: found.id }, select: { id: true, code: true, status: true, startCodeAttempts: true } });
      if (b.status !== 'ARRIVED') throw new AppError('CONFLICT', {}, `the visit is ${b.status}, not waiting for the start code`);
      if (b.startCodeAttempts < max) throw new AppError('CONFLICT', {}, 'the start code is not locked');
      await tx.booking.update({ where: { id: b.id }, data: { startCodeAttempts: 0, version: { increment: 1 } } });
      const tickets = await tx.supportTicket.findMany({ where: { bookingId: b.id, kind: 'START_CODE_LOCKED', state: { not: 'RESOLVED' } }, select: { id: true } });
      if (tickets.length > 0) {
        await tx.supportTicket.updateMany({
          where: { id: { in: tickets.map((t) => t.id) } },
          data: { state: 'RESOLVED', resolvedAt: new Date(this.clock.now()), resolvedBy: actor.id, resolution: 'Start code unlocked by support' },
        });
      }
      await this.audit.record(
        {
          actorType: actor.type, actorId: actor.id, action: 'support.unlock_start_code', entity: 'booking', entityId: b.id,
          before: { startCodeAttempts: b.startCodeAttempts }, after: { startCodeAttempts: 0, via: actor.via, resolvedTickets: tickets.map((t) => t.id) },
        },
        tx,
      );
      return { code: b.code, ticketsResolved: tickets.length };
    });
  }

  async raise(raiser: Raiser, input: { bookingId?: string; kind: TicketKind; note?: string; location?: Position }): Promise<{ ticketId: string }> {
    const booking = input.bookingId ? await this.ownBooking(raiser, input.bookingId) : null;
    const priority = TICKET_PRIORITY[input.kind];
    const now = new Date(this.clock.now());
    const ticket = await this.prisma.supportTicket.create({
      data: { bookingId: booking?.id ?? null, raisedBy: raiser.id, kind: input.kind, note: input.note?.trim() ?? '', priority, createdAt: now, ...positionColumns(input.location, now) },
    });
    if (priority === 'URGENT') {
      // Until the safety team has a pager (QUESTIONS.md #55), the log alert is how an urgent ticket gets seen.
      this.log.error(`URGENT ${input.kind} ticket ${ticket.id}${booking ? ` on booking ${booking.code}` : ''} from a ${raiser.role.toLowerCase()}`);
    } else if (priority === 'HIGH') this.log.warn(`HIGH ${input.kind} ticket ${ticket.id}${booking ? ` on booking ${booking.code}` : ''}`);
    return { ticketId: ticket.id };
  }

  /**
   * "Call me back": one open request per person and booking. Asking again while it is open returns the same ticket
   * (and adds the new reason to it), so a worried customer tapping twice does not queue two calls.
   */
  async callback(raiser: Raiser, input: { bookingId?: string; reason?: string }): Promise<{ ticketId: string }> {
    const booking = input.bookingId ? await this.ownBooking(raiser, input.bookingId) : null;
    const reason = input.reason?.trim() ?? '';
    const open = () => this.prisma.supportTicket.findFirst({ where: { raisedBy: raiser.id, bookingId: booking?.id ?? null, kind: 'CALLBACK', state: { not: 'RESOLVED' } } });
    const existing = await open();
    if (existing) {
      if (reason && !existing.note.includes(reason)) {
        await this.prisma.supportTicket.update({ where: { id: existing.id }, data: { note: [existing.note, reason].filter(Boolean).join('\n').slice(0, 2000) } });
      }
      return { ticketId: existing.id };
    }
    const priority: TicketPriority = booking && ACTIVE_STATUSES.includes(booking.status) ? 'HIGH' : 'NORMAL';
    try {
      const ticket = await this.prisma.supportTicket.create({
        data: { bookingId: booking?.id ?? null, raisedBy: raiser.id, kind: 'CALLBACK', note: reason, priority, createdAt: new Date(this.clock.now()) },
      });
      return { ticketId: ticket.id };
    } catch (e) {
      // Two taps at once: the other request made it (partial unique index).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ticketId: (await open())!.id };
      throw e;
    }
  }

  // ---------- the support team (command line until the admin portal) ----------

  /** Open tickets, most urgent first, then oldest first. */
  async open(): Promise<TicketRow[]> {
    const rows = await this.prisma.supportTicket.findMany({
      where: { state: { not: 'RESOLVED' } },
      include: { booking: { select: { code: true } }, raiser: { select: { role: true } } },
      orderBy: [{ createdAt: 'asc' }],
    });
    const rank: Record<TicketPriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2 };
    return rows
      .sort((a, b) => rank[a.priority] - rank[b.priority])
      .map((t) => ({ id: t.id, kind: t.kind, priority: t.priority, state: t.state, bookingCode: t.booking?.code ?? null, raisedByRole: t.raiser.role, note: t.note, createdAt: t.createdAt }));
  }

  async resolve(ticketId: string, resolution: string, actor: SupportActor): Promise<void> {
    if (!UUID.test(ticketId)) throw new AppError('NOT_FOUND');
    const text = resolution.trim();
    if (text.length < 3) throw new AppError('VALIDATION', { fields: { resolution: 'INVALID' } }, 'say what was done');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM support_tickets WHERE id = ${ticketId}::uuid FOR UPDATE`;
      const t = await tx.supportTicket.findUnique({ where: { id: ticketId } });
      if (!t) throw new AppError('NOT_FOUND');
      if (t.state === 'RESOLVED') throw new AppError('CONFLICT', {}, 'already resolved');
      await tx.supportTicket.update({ where: { id: ticketId }, data: { state: 'RESOLVED', resolvedAt: new Date(this.clock.now()), resolvedBy: actor.id, resolution: text } });
      await this.audit.record(
        { actorType: actor.type, actorId: actor.id, action: 'support.resolve', entity: 'support_ticket', entityId: ticketId, before: { state: t.state }, after: { state: 'RESOLVED', via: actor.via } },
        tx,
      );
    });
  }

  /** The caller's own booking: a customer's, or a job assigned to the technician. NOT_FOUND for anyone else's. */
  private async ownBooking(raiser: Raiser, bookingId: string) {
    if (!UUID.test(bookingId)) throw new AppError('NOT_FOUND');
    const owner = raiser.role === 'TECHNICIAN' ? { technicianId: raiser.id } : { customerId: raiser.id };
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId, ...owner }, select: { id: true, code: true, status: true } });
    if (!b) throw new AppError('NOT_FOUND');
    return b;
  }
}
