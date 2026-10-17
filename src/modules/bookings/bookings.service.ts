import { Injectable } from '@nestjs/common';
import { type CancelReason, Prisma } from '@prisma/client';
import { createHash, randomInt } from 'node:crypto';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { digestsEqual } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { type AddressDto, AddressesService } from '../addresses/addresses.service';
import { PaymentsService } from '../payments/payments.service';
import { SlotsService } from '../slots/slots.service';
import { type Actor, BookingCore } from './booking-core';
import { ACTIVE_STATUSES, CANCELLABLE, REFUND_ON_CANCEL, RESCHEDULABLE } from './booking-status';
import { BOOKING_INCLUDE, type BookingDto, type BookingRow } from './booking-view';
import type { NewBooking, VisitTime } from './bookings.schemas';

const CODE_ATTEMPTS = 10;

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

/** The customer's booking actions. Shared mechanics (locks, transitions, reads, expiry) live in BookingCore. */
@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly addresses: AddressesService,
    private readonly slots: SlotsService,
    private readonly payments: PaymentsService,
    private readonly core: BookingCore,
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
          await this.core.event(tx, b.id, 'AWAITING_PAYMENT', actor);
          return b.id;
        });
        return { booking: await this.core.get(customerId, id), created: true };
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

  get(customerId: string, id: string): Promise<BookingDto> {
    return this.core.get(customerId, id);
  }

  list(customerId: string, scope: 'active' | 'past' | 'all'): Promise<BookingDto[]> {
    return this.core.list(customerId, scope);
  }

  // ---------- customer actions ----------

  /**
   * Cancels with an optional reason. The visit fee is refunded when cancelled before the technician starts
   * travelling. Cancelling an already cancelled booking returns it unchanged (safe to retry).
   */
  async cancel(customerId: string, id: string, reason: CancelReason | null): Promise<BookingDto> {
    const refunded = await this.core.mutateOwned(customerId, id, async (tx, b) => {
      if (b.status === 'CANCELLED') return { changed: false, result: false };
      if (!CANCELLABLE.includes(b.status)) throw new AppError('CONFLICT');
      const refund = REFUND_ON_CANCEL.includes(b.status);
      await this.core.transition(tx, b, 'CANCELLED', { cancelReason: reason, etaMin: null }, { type: 'CUSTOMER', id: customerId }, { refund });
      const marked = refund ? await this.payments.refundVisitFee(tx, b.id, this.core.now()) : false;
      // Step 8: withdraw open offers / free the assigned technician (JOB_CANCELLED).
      return { changed: true, result: marked };
    });
    if (refunded) this.payments.sendRefundsSoon(id);
    return this.core.get(customerId, id);
  }

  /** New time for a booking still searching, unfulfilled or assigned: it goes back to MATCHING. */
  async reschedule(customerId: string, id: string, time: VisitTime): Promise<BookingDto> {
    await this.core.mutateOwned(customerId, id, async (tx, b) => {
      if (!RESCHEDULABLE.includes(b.status)) throw new AppError('CONFLICT');
      await this.slots.hold(tx, { categoryId: b.categoryId, pincode: b.pincode }, time, b.id);
      // Step 8: the previously assigned technician is released and told.
      await this.core.transition(tx, b, 'MATCHING', { ...windowFields(time), technician: { disconnect: true }, etaMin: null }, { type: 'CUSTOMER', id: customerId }, { rescheduled: true });
      return { changed: true, result: undefined };
    });
    return this.core.get(customerId, id);
  }

  /** Cancels unpaid bookings past UNPAID_BOOKING_EXPIRY_MIN. */
  expireUnpaid(batch?: number): Promise<number> {
    return this.core.expireUnpaid(batch);
  }

  /**
   * Account deletion (inside the caller's transaction). Refused with CONFLICT while a booking is under way (paid
   * and not finished); unpaid bookings are cancelled. Every booking of the customer is then anonymised: address
   * snapshot, notes, voice transcript and location are wiped. Codes, amounts, statuses and the timeline stay for
   * accounting and the technicians' earnings.
   */
  async anonymiseForDeletion(tx: Prisma.TransactionClient, customerId: string): Promise<void> {
    const underWay = await tx.booking.count({
      where: { customerId, status: { in: ACTIVE_STATUSES.filter((s) => s !== 'AWAITING_PAYMENT') } },
    });
    if (underWay > 0) throw new AppError('CONFLICT', {}, 'a booking is still in progress');
    const unpaid = await tx.booking.findMany({ where: { customerId, status: 'AWAITING_PAYMENT' } });
    for (const b of unpaid) {
      await this.core.transition(tx, b, 'CANCELLED', { cancelReason: 'OTHER' }, { type: 'CUSTOMER', id: customerId }, { reason: 'account deleted' });
    }
    await tx.booking.updateMany({
      where: { customerId },
      data: { addressSnapshotEnc: new Uint8Array(0), notes: '', voiceTranscript: null, locality: '' },
    });
    await tx.$executeRaw`UPDATE bookings SET location = NULL WHERE customer_id = ${customerId}::uuid`;
  }

  // ---------- internals ----------

  private findByKey(customerId: string, idempotencyKey: string): Promise<BookingRow | null> {
    return this.prisma.booking.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey } }, include: BOOKING_INCLUDE });
  }

  private async replay(existing: BookingRow, requestHash: Uint8Array): Promise<CreateResult> {
    if (!digestsEqual(existing.idempotencyHash, requestHash)) throw new AppError('CONFLICT', {}, 'Idempotency-Key reused with a different request');
    return { booking: await this.core.get(existing.customerId, existing.id), created: false };
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
