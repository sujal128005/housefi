import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type TicketPriority, type UserRole } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { ACTIVE_STATUSES } from '../bookings/booking-status';

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
    @InjectClock() private readonly clock: Clock,
  ) {}

  async raise(raiser: Raiser, input: { bookingId?: string; kind: TicketKind; note?: string }): Promise<{ ticketId: string }> {
    const booking = input.bookingId ? await this.ownBooking(raiser, input.bookingId) : null;
    const priority = TICKET_PRIORITY[input.kind];
    const ticket = await this.prisma.supportTicket.create({
      data: { bookingId: booking?.id ?? null, raisedBy: raiser.id, kind: input.kind, note: input.note?.trim() ?? '', priority, createdAt: new Date(this.clock.now()) },
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
