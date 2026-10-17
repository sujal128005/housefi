import { Injectable, Logger } from '@nestjs/common';
import { type ActorType, type Booking, type BookingStatus, type CancelReason, Prisma } from '@prisma/client';
import { createHash, randomInt } from 'node:crypto';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { digestsEqual } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { type AddressDto, AddressesService } from '../addresses/addresses.service';
import { PaymentsService } from '../payments/payments.service';
import { SlotsService } from '../slots/slots.service';
import { ACTIVE_STATUSES, CANCELLABLE, canTransition, REFUND_ON_CANCEL, RESCHEDULABLE } from './booking-status';
import { BookingUpdates } from './booking-updates';
import { BOOKING_INCLUDE, type BookingDto, type BookingRow, toBookingDto } from './booking-view';
import type { NewBooking, VisitTime } from './bookings.schemas';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Lists return the newest bookings first, at most this many. */
export const LIST_LIMIT = 50;
const CODE_ATTEMPTS = 10;

interface Actor {
  readonly type: ActorType;
  readonly id: string | null;
}

export interface CreateResult {
  readonly booking: BookingDto;
  /** False when the Idempotency-Key was seen before and the original booking is returned. */
  readonly created: boolean;
}

const validation = (field: string) => new AppError('VALIDATION', { fields: { [field]: 'INVALID' } });

function windowFields(time: VisitTime) {
  return time.mode === 'SCHEDULED'
    ? { timeMode: 'SCHEDULED' as const, windowDate: new Date(`${time.window.date}T00:00:00Z`), windowStartHour: time.window.startHour, windowEndHour: time.window.endHour }
    : { timeMode: 'INSTANT' as const, windowDate: null, windowStartHour: null, windowEndHour: null };
}

function isUniqueViolation(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

@Injectable()
export class BookingsService {
  private readonly log = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly addresses: AddressesService,
    private readonly slots: SlotsService,
    private readonly payments: PaymentsService,
    private readonly updates: BookingUpdates,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  // ---------- create ----------

  /**
   * Creates a booking in AWAITING_PAYMENT with a DUE visit fee. Idempotent per customer and Idempotency-Key: the
   * same key with the same body returns the original booking; with a different body it is CONFLICT.
   */
  async create(customerId: string, idempotencyKey: string, input: NewBooking): Promise<CreateResult> {
    const requestHash = new Uint8Array(createHash('sha256').update(JSON.stringify(input)).digest());
    const replay = await this.findByKey(customerId, idempotencyKey);
    if (replay) return this.replay(replay, requestHash);

    const service = await this.prisma.service.findFirst({ where: { id: input.serviceId, active: true }, include: { issues: { select: { id: true } } } });
    if (!service) throw validation('serviceId');
    const known = new Set(service.issues.map((i) => i.id));
    if (input.problem.issueIds.some((id) => !known.has(id))) throw validation('problem.issueIds');
    // Uploads arrive in step 10; until then no photo or audio id can exist.
    if (input.problem.photos.length > 0) throw validation('problem.photos');
    if (input.problem.voiceNote?.audioId !== undefined) throw validation('problem.voiceNote.audioId');
    const address = await this.ownedAddress(customerId, input.addressId);

    const addressSnapshotEnc = await this.cipher.encrypt('bookings.address', JSON.stringify(address));
    const arrivalCodeEnc = await this.cipher.encrypt('bookings.arrival_code', String(randomInt(0, 10_000)).padStart(4, '0'));
    const now = new Date(this.clock.now());
    const actor: Actor = { type: 'CUSTOMER', id: customerId };

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      // 5 digits as in the contract; after repeated collisions fall back to 6 (the space is only 90,000 codes).
      const code = `HF-${randomInt(attempt < 6 ? 10_000 : 100_000, attempt < 6 ? 100_000 : 1_000_000)}`;
      try {
        const id = await this.prisma.$transaction(async (tx) => {
          await this.slots.hold(tx, { categoryId: service.categoryId, pincode: address.pincode }, input.time);
          const b = await tx.booking.create({
            data: {
              code,
              customerId,
              serviceId: service.id,
              categoryId: service.categoryId,
              addressSnapshotEnc,
              locality: (await tx.address.findUniqueOrThrow({ where: { id: address.id }, select: { locality: true } })).locality,
              city: address.city,
              pincode: address.pincode,
              issueIds: input.problem.issueIds,
              notes: input.problem.notes,
              voiceTranscript: input.problem.voiceNote?.transcript ?? null,
              voiceDurationSec: input.problem.voiceNote?.durationSec ?? null,
              ...windowFields(input.time),
              preferWomenRated: input.preferWomenRated,
              status: 'AWAITING_PAYMENT',
              arrivalCodeEnc,
              idempotencyKey,
              idempotencyHash: requestHash,
              createdAt: now,
            },
            select: { id: true },
          });
          await tx.$executeRaw`UPDATE bookings SET location = (SELECT location FROM addresses WHERE id = ${address.id}::uuid) WHERE id = ${b.id}::uuid`;
          await this.payments.createDue(tx, b.id, 'VISIT', service.visitFeePaise);
          await this.event(tx, b.id, 'AWAITING_PAYMENT', actor, now);
          return b.id;
        });
        return { booking: await this.get(customerId, id), created: true };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const target = String(e.meta?.target ?? '');
        if (target.includes('idempotency')) {
          // The same request raced with itself: return the one that won.
          const winner = await this.findByKey(customerId, idempotencyKey);
          if (winner) return this.replay(winner, requestHash);
        }
        if (!target.includes('code')) throw e;
      }
    }
    throw new Error('could not allocate a unique booking code');
  }

  // ---------- read ----------

  async get(customerId: string, id: string): Promise<BookingDto> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    let row = await this.prisma.booking.findFirst({ where: { id, customerId }, include: BOOKING_INCLUDE });
    if (!row) throw new AppError('NOT_FOUND');
    if (this.isOverdueUnpaid(row)) {
      await this.expireOne(row.id);
      row = await this.prisma.booking.findFirstOrThrow({ where: { id, customerId }, include: BOOKING_INCLUDE });
    }
    return toBookingDto(row, this.cipher);
  }

  async list(customerId: string, scope: 'active' | 'past' | 'all'): Promise<BookingDto[]> {
    // Unpaid bookings past their 30 minutes are expired first, so nobody sees one as still active.
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

  // ---------- customer actions ----------

  /**
   * Cancels with an optional reason. The visit fee is refunded when cancelled before the technician starts
   * travelling. Cancelling an already cancelled booking returns it unchanged (safe to retry).
   */
  async cancel(customerId: string, id: string, reason: CancelReason | null): Promise<BookingDto> {
    await this.mutate(customerId, id, async (tx, b, now) => {
      if (b.status === 'CANCELLED') return false;
      if (!CANCELLABLE.includes(b.status)) throw new AppError('CONFLICT');
      const refund = REFUND_ON_CANCEL.includes(b.status);
      await this.transition(tx, b, 'CANCELLED', { cancelReason: reason, etaMin: null }, { type: 'CUSTOMER', id: customerId }, now, { refund });
      if (refund) await this.payments.refundVisitFee(tx, b.id, now);
      // Step 8: withdraw open offers / free the assigned technician (JOB_CANCELLED).
      return true;
    });
    return this.get(customerId, id);
  }

  /** New time for a booking still searching, unfulfilled or assigned: it goes back to MATCHING. */
  async reschedule(customerId: string, id: string, time: VisitTime): Promise<BookingDto> {
    await this.mutate(customerId, id, async (tx, b, now) => {
      if (!RESCHEDULABLE.includes(b.status)) throw new AppError('CONFLICT');
      await this.slots.hold(tx, { categoryId: b.categoryId, pincode: b.pincode }, time, b.id);
      // Step 8: the previously assigned technician is released and told.
      await this.transition(tx, b, 'MATCHING', { ...windowFields(time), technicianId: null, etaMin: null }, { type: 'CUSTOMER', id: customerId }, now, { rescheduled: true });
      return true;
    });
    return this.get(customerId, id);
  }

  // ---------- system ----------

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

  /**
   * Account deletion (inside the caller's transaction). Refused with CONFLICT while a booking is under way (paid
   * and not finished); unpaid bookings are cancelled. Every booking of the customer is then anonymised: address
   * snapshot, notes, voice transcript and location are wiped. Codes, amounts, statuses and the timeline stay for
   * accounting and the technicians' earnings.
   */
  async anonymiseForDeletion(tx: Prisma.TransactionClient, customerId: string, now: Date): Promise<void> {
    const underWay = await tx.booking.count({
      where: { customerId, status: { in: ACTIVE_STATUSES.filter((s) => s !== 'AWAITING_PAYMENT') } },
    });
    if (underWay > 0) throw new AppError('CONFLICT', {}, 'a booking is still in progress');
    const unpaid = await tx.booking.findMany({ where: { customerId, status: 'AWAITING_PAYMENT' } });
    for (const b of unpaid) {
      await this.transition(tx, b, 'CANCELLED', { cancelReason: 'OTHER' }, { type: 'CUSTOMER', id: customerId }, now, { reason: 'account deleted' });
    }
    await tx.booking.updateMany({
      where: { customerId },
      data: { addressSnapshotEnc: new Uint8Array(0), notes: '', voiceTranscript: null, locality: '' },
    });
    await tx.$executeRaw`UPDATE bookings SET location = NULL WHERE customer_id = ${customerId}::uuid`;
  }

  // ---------- internals ----------

  private async expireOne(bookingId: string): Promise<boolean> {
    const changed = await this.prisma.$transaction(async (tx) => {
      const b = await this.lock(tx, bookingId);
      // Re-checked under the lock: the customer may have paid or cancelled meanwhile.
      if (!b || !this.isOverdueUnpaid(b)) return false;
      await this.transition(tx, b, 'CANCELLED', { cancelReason: 'UNPAID_EXPIRED' }, { type: 'SYSTEM', id: null }, new Date(this.clock.now()), {
        reason: 'unpaid',
      });
      return true;
    });
    if (changed) this.updates.publish(bookingId);
    return changed;
  }

  /** Locks the customer's booking row, runs `fn`, and publishes a live update if `fn` changed something. */
  private async mutate(
    customerId: string,
    id: string,
    fn: (tx: Prisma.TransactionClient, b: Booking, now: Date) => Promise<boolean>,
  ): Promise<void> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    const before = await this.prisma.booking.findFirst({ where: { id, customerId }, select: { status: true, createdAt: true } });
    if (!before) throw new AppError('NOT_FOUND');
    // An unpaid booking past its time is expired first, so the action sees CANCELLED.
    if (this.isOverdueUnpaid(before)) await this.expireOne(id);
    const changed = await this.prisma.$transaction(async (tx) => {
      const b = await this.lock(tx, id);
      if (!b || b.customerId !== customerId) throw new AppError('NOT_FOUND');
      return fn(tx, b, new Date(this.clock.now()));
    });
    if (changed) this.updates.publish(id);
  }

  /** SELECT ... FOR UPDATE: concurrent actions on one booking run one after another. */
  private async lock(tx: Prisma.TransactionClient, id: string): Promise<Booking | null> {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.booking.findUnique({ where: { id } });
  }

  private async transition(
    tx: Prisma.TransactionClient,
    b: Booking,
    to: BookingStatus,
    data: Prisma.BookingUpdateInput,
    actor: Actor,
    now: Date,
    meta: Prisma.InputJsonObject = {},
  ): Promise<void> {
    if (!canTransition(b.status, to)) throw new AppError('CONFLICT');
    await tx.booking.update({ where: { id: b.id }, data: { ...data, status: to, version: { increment: 1 } } });
    await this.event(tx, b.id, to, actor, now, { from: b.status, ...meta });
  }

  private async event(tx: Prisma.TransactionClient, bookingId: string, status: BookingStatus, actor: Actor, at: Date, meta: Prisma.InputJsonObject = {}) {
    await tx.bookingEvent.create({ data: { bookingId, status, actorType: actor.type, actorId: actor.id, meta, at } });
  }

  private unpaidCutoff(): Date {
    return new Date(this.clock.now() - this.config.UNPAID_BOOKING_EXPIRY_MIN * 60_000);
  }

  private isOverdueUnpaid(b: Pick<Booking, 'status' | 'createdAt'>): boolean {
    return b.status === 'AWAITING_PAYMENT' && b.createdAt <= this.unpaidCutoff();
  }

  private findByKey(customerId: string, idempotencyKey: string): Promise<BookingRow | null> {
    return this.prisma.booking.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey } }, include: BOOKING_INCLUDE });
  }

  private async replay(existing: BookingRow, requestHash: Uint8Array): Promise<CreateResult> {
    if (!digestsEqual(existing.idempotencyHash, requestHash)) throw new AppError('CONFLICT', {}, 'Idempotency-Key reused with a different request');
    return { booking: await this.get(existing.customerId, existing.id), created: false };
  }

  private async ownedAddress(customerId: string, addressId: string): Promise<AddressDto> {
    try {
      return await this.addresses.getOwned(customerId, addressId);
    } catch (e) {
      if (e instanceof AppError && e.code === 'NOT_FOUND') throw validation('addressId');
      throw e;
    }
  }
}
