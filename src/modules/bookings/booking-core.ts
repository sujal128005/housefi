// Shared booking machinery used by bookings, payments and (later) dispatch and jobs: row locks, state-machine
// transitions with timeline events, reads in the API shape, and the unpaid-booking expiry. It depends on nothing
// above it, so any module can use it without circular imports.
import { Injectable } from '@nestjs/common';
import type { ActorType, Booking, BookingStatus, Prisma } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { ACTIVE_STATUSES, canTransition } from './booking-status';
import { BookingUpdates } from './booking-updates';
import { BOOKING_INCLUDE, type BookingDto, toBookingDto } from './booking-view';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Lists return the newest bookings first, at most this many. */
export const LIST_LIMIT = 50;
/** An unpaid booking is not expired while the customer is in the payment sheet (an order made this recently). */
export const PAYMENT_ATTEMPT_GRACE_MIN = 15;

export interface Actor {
  readonly type: ActorType;
  readonly id: string | null;
}

export const SYSTEM: Actor = { type: 'SYSTEM', id: null };

@Injectable()
export class BookingCore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    readonly updates: BookingUpdates,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  now(): Date {
    return new Date(this.clock.now());
  }

  // ---------- writes ----------

  /** SELECT ... FOR UPDATE: concurrent actions on one booking run one after another. */
  async lock(tx: Prisma.TransactionClient, id: string): Promise<Booking | null> {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.booking.findUnique({ where: { id } });
  }

  /** Moves a locked booking to `to` (CONFLICT if the state machine does not allow it) and records the event. */
  async transition(
    tx: Prisma.TransactionClient,
    b: Booking,
    to: BookingStatus,
    data: Prisma.BookingUpdateInput,
    actor: Actor,
    meta: Prisma.InputJsonObject = {},
  ): Promise<void> {
    if (!canTransition(b.status, to)) throw new AppError('CONFLICT');
    await tx.booking.update({ where: { id: b.id }, data: { ...data, status: to, version: { increment: 1 } } });
    await this.event(tx, b.id, to, actor, { from: b.status, ...meta });
  }

  async event(tx: Prisma.TransactionClient, bookingId: string, status: BookingStatus, actor: Actor, meta: Prisma.InputJsonObject = {}): Promise<void> {
    await tx.bookingEvent.create({ data: { bookingId, status, actorType: actor.type, actorId: actor.id, meta, at: this.now() } });
  }

  /**
   * Runs `fn` on the customer's locked booking (NOT_FOUND for anyone else's), expiring it first if it is an overdue
   * unpaid booking, and publishes a live update when `fn` reports a change.
   */
  async mutateOwned<T>(
    customerId: string,
    id: string,
    fn: (tx: Prisma.TransactionClient, b: Booking) => Promise<{ changed: boolean; result: T }>,
  ): Promise<T> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    const before = await this.prisma.booking.findFirst({ where: { id, customerId }, select: { status: true, createdAt: true } });
    if (!before) throw new AppError('NOT_FOUND');
    if (this.isOverdueUnpaid(before)) await this.expireOne(id);
    const { changed, result } = await this.prisma.$transaction(async (tx) => {
      const b = await this.lock(tx, id);
      if (!b || b.customerId !== customerId) throw new AppError('NOT_FOUND');
      return fn(tx, b);
    });
    if (changed) this.updates.publish(id);
    return result;
  }

  // ---------- reads ----------

  async get(customerId: string, id: string): Promise<BookingDto> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    const row = await this.prisma.booking.findFirst({ where: { id, customerId }, select: { status: true, createdAt: true } });
    if (!row) throw new AppError('NOT_FOUND');
    if (this.isOverdueUnpaid(row)) await this.expireOne(id);
    return toBookingDto(await this.prisma.booking.findUniqueOrThrow({ where: { id }, include: BOOKING_INCLUDE }), this.cipher);
  }

  async list(customerId: string, scope: 'active' | 'past' | 'all'): Promise<BookingDto[]> {
    // Unpaid bookings past their time are expired first, so nobody sees one as still active.
    const overdue = await this.prisma.booking.findMany({
      where: { customerId, status: 'AWAITING_PAYMENT', createdAt: { lte: this.unpaidCutoff() } },
      select: { id: true },
    });
    for (const b of overdue) await this.expireOne(b.id);
    const status = scope === 'active' ? { in: [...ACTIVE_STATUSES] } : scope === 'past' ? { notIn: [...ACTIVE_STATUSES] } : undefined;
    const rows = await this.prisma.booking.findMany({
      where: { customerId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      include: BOOKING_INCLUDE,
    });
    return Promise.all(rows.map((r) => toBookingDto(r, this.cipher)));
  }

  // ---------- unpaid expiry ----------

  /** Cancels unpaid bookings older than UNPAID_BOOKING_EXPIRY_MIN (releasing their slot). Returns how many. */
  async expireUnpaid(batch = 100): Promise<number> {
    const due = await this.prisma.booking.findMany({
      where: { status: 'AWAITING_PAYMENT', createdAt: { lte: this.unpaidCutoff() } },
      orderBy: { createdAt: 'asc' },
      take: batch,
      select: { id: true },
    });
    let expired = 0;
    for (const b of due) if (await this.expireOne(b.id)) expired++;
    return expired;
  }

  private async expireOne(bookingId: string): Promise<boolean> {
    const changed = await this.prisma.$transaction(async (tx) => {
      const b = await this.lock(tx, bookingId);
      // Re-checked under the lock: the customer may have paid or cancelled meanwhile.
      if (!b || !this.isOverdueUnpaid(b)) return false;
      const paying = await tx.payment.count({
        where: { bookingId, kind: 'VISIT', state: 'PROCESSING', orderedAt: { gt: new Date(this.clock.now() - PAYMENT_ATTEMPT_GRACE_MIN * 60_000) } },
      });
      if (paying > 0) return false;
      await this.transition(tx, b, 'CANCELLED', { cancelReason: 'UNPAID_EXPIRED' }, SYSTEM, { reason: 'unpaid' });
      return true;
    });
    if (changed) this.updates.publish(bookingId);
    return changed;
  }

  private unpaidCutoff(): Date {
    return new Date(this.clock.now() - this.config.UNPAID_BOOKING_EXPIRY_MIN * 60_000);
  }

  private isOverdueUnpaid(b: Pick<Booking, 'status' | 'createdAt'>): boolean {
    return b.status === 'AWAITING_PAYMENT' && b.createdAt <= this.unpaidCutoff();
  }
}
