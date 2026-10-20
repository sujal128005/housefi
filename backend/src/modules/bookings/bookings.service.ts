import { Injectable } from '@nestjs/common';
import { type CancelReason, Prisma } from '@prisma/client';
import { createHash, randomInt } from 'node:crypto';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { digestsEqual } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { type AddressDto, AddressesService } from '../addresses/addresses.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { PaymentsService } from '../payments/payments.service';
import { SlotsService } from '../slots/slots.service';
import { UploadsService } from '../uploads/uploads.service';
import { type Actor, BookingCore } from './booking-core';
import { ACTIVE_STATUSES, CANCELLABLE, REFUND_ON_CANCEL, RESCHEDULABLE } from './booking-status';
import { BOOKING_INCLUDE, type BookingDto, type BookingRow, WARRANTY_DAYS } from './booking-view';
import type { NewBooking, VisitTime } from './bookings.schemas';

const CODE_ATTEMPTS = 10;
/** Open unpaid bookings per customer (each holds a slot until paid or expired). */
export const MAX_UNPAID_BOOKINGS = 2;

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
/** The women-rated badge: at least this many ratings from women customers, averaging at least WOMEN_RATED_AVG stars. */
export const WOMEN_RATED_MIN = 5;
export const WOMEN_RATED_AVG = 4.5;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly addresses: AddressesService,
    private readonly slots: SlotsService,
    private readonly payments: PaymentsService,
    private readonly core: BookingCore,
    private readonly dispatch: DispatchService,
    private readonly uploads: UploadsService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  // ---------- create ----------

  /**
   * Creates a booking in AWAITING_PAYMENT (at most MAX_UNPAID_BOOKINGS at a time per customer) with a DUE visit fee. Idempotent per customer and Idempotency-Key: the
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
    // Photos and the voice note must be the customer's own uploads, checked (type, size, length; photo location removed).
    const photoIds = input.problem.photos.map((p) => p.id);
    await this.uploads.ready(customerId, photoIds, 'PHOTO', 'problem.photos', 'PROBLEM');
    const audioId = input.problem.voiceNote?.audioId;
    const [audio] = audioId ? await this.uploads.ready(customerId, [audioId], 'AUDIO', 'problem.voiceNote.audioId') : [];
    const address = await this.ownedAddress(customerId, input.addressId);
    const preferredTechnicianId = input.repeatOf ? await this.repeatTechnician(customerId, input.repeatOf) : null;
    // A team demo account's booking is a demo booking (kept apart from real customers and technicians).
    const isDemo = (await this.prisma.user.findUnique({ where: { id: customerId }, select: { isDemo: true } }))?.isDemo ?? false;

    const addressSnapshotEnc = await this.cipher.encrypt('bookings.address', JSON.stringify(address));
    const arrivalCodeEnc = await this.cipher.encrypt('bookings.arrival_code', String(randomInt(0, 10_000)).padStart(4, '0'));
    const now = new Date(this.clock.now());
    const actor: Actor = { type: 'CUSTOMER', id: customerId };

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      // 5 digits as in the contract; after repeated collisions fall back to 6 (the space is only 90,000 codes).
      const code = `HF-${randomInt(attempt < 6 ? 10_000 : 100_000, attempt < 6 ? 100_000 : 1_000_000)}`;
      try {
        const id = await this.prisma.$transaction(async (tx) => {
          // Unpaid bookings hold slots: one person must not be able to fill every window without paying.
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${customerId}::uuid FOR UPDATE`;
          const unpaid = await tx.booking.count({ where: { customerId, status: 'AWAITING_PAYMENT', createdAt: { gt: this.core.unpaidCutoff() } } });
          if (unpaid >= MAX_UNPAID_BOOKINGS) throw new AppError('CONFLICT', {}, 'pay for or cancel your unpaid booking first');
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
              // The recording's real length when there is one, not what the app says.
              voiceDurationSec: audio?.durationSec ?? input.problem.voiceNote?.durationSec ?? null,
              ...windowFields(input.time),
              preferWomenRated: input.preferWomenRated,
              preferredTechnicianId,
              isDemo,
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
          await this.uploads.attach(tx, b.id, customerId, photoIds, 'problem.photos');
          if (audio) await this.uploads.attach(tx, b.id, customerId, [audio.id], 'problem.voiceNote.audioId');
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

  // ---------- warranty ----------

  /**
   * "Not fixed? Free revisit": within WARRANTY_DAYS of a completed job, once per booking (and not for a revisit
   * itself). A new booking for the same service and address starts searching at once with the visit fee paid by
   * Housefi, offered first to the same technician, ahead of other searching jobs. The technician can close it as fixed
   * at no charge, or quote as usual for a different problem.
   */
  async claimWarranty(customerId: string, id: string, note: string): Promise<BookingDto> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND');
    const original = await this.prisma.booking.findFirst({ where: { id, customerId }, include: { warrantyClaim: { select: { id: true } }, events: { where: { status: 'COMPLETED' }, select: { at: true } } } });
    if (!original) throw new AppError('NOT_FOUND');
    const doneAt = original.events[0]?.at.getTime();
    if (original.status !== 'COMPLETED' || !doneAt) throw new AppError('CONFLICT', {}, 'only a completed job has a warranty');
    if (original.warrantyOfId) throw new AppError('CONFLICT', {}, 'a free revisit is already a warranty visit');
    if (original.warrantyClaim) return this.core.get(customerId, original.warrantyClaim.id);
    if (this.clock.now() > doneAt + WARRANTY_DAYS * 86_400_000) throw new AppError('CONFLICT', {}, `the ${WARRANTY_DAYS}-day warranty has ended`);
    const service = await this.prisma.service.findUniqueOrThrow({ where: { id: original.serviceId } });
    const text = note.trim().slice(0, 400);
    const now = new Date(this.clock.now());
    const actor: Actor = { type: 'CUSTOMER', id: customerId };
    const arrivalCodeEnc = await this.cipher.encrypt('bookings.arrival_code', String(randomInt(0, 10_000)).padStart(4, '0'));
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = `HF-${randomInt(attempt < 6 ? 10_000 : 100_000, attempt < 6 ? 100_000 : 1_000_000)}`;
      try {
        const newId = await this.prisma.$transaction(async (tx) => {
          await this.slots.hold(tx, { categoryId: original.categoryId, pincode: original.pincode }, { mode: 'INSTANT', window: null });
          const b = await tx.booking.create({
            data: {
              code,
              customerId,
              serviceId: original.serviceId,
              categoryId: original.categoryId,
              addressSnapshotEnc: original.addressSnapshotEnc,
              locality: original.locality,
              city: original.city,
              pincode: original.pincode,
              issueIds: original.issueIds,
              notes: `Warranty revisit of ${original.code}${text ? `: ${text}` : ''}`.slice(0, 500),
              ...windowFields({ mode: 'INSTANT', window: null }),
              preferWomenRated: original.preferWomenRated,
              preferredTechnicianId: original.technicianId,
              isDemo: original.isDemo,
              status: 'MATCHING',
              matchingStartedAt: now,
              arrivalCodeEnc,
              idempotencyKey: `warranty-${original.id}`,
              idempotencyHash: new Uint8Array(createHash('sha256').update(`warranty:${original.id}`).digest()),
              warrantyOfId: original.id,
              priority: true,
              createdAt: now,
            },
            select: { id: true },
          });
          await tx.$executeRaw`UPDATE bookings SET location = (SELECT location FROM bookings WHERE id = ${original.id}::uuid) WHERE id = ${b.id}::uuid`;
          // The visit is on Housefi (not revenue).
          await tx.payment.create({ data: { bookingId: b.id, kind: 'VISIT', amountPaise: service.visitFeePaise, state: 'PAID', provider: 'WAIVED', settledAt: now, createdAt: now } });
          await this.core.event(tx, b.id, 'MATCHING', actor, { warrantyOf: original.code });
          return b.id;
        });
        await this.dispatch.offerNext(newId);
        return this.core.get(customerId, newId);
      } catch (e) {
        if (isUniqueViolation(e) && String(e.meta?.target ?? '').includes('warranty')) {
          const claim = await this.prisma.booking.findUnique({ where: { warrantyOfId: original.id }, select: { id: true } });
          if (claim) return this.core.get(customerId, claim.id);
        }
        if (!isUniqueViolation(e) || !String(e.meta?.target ?? '').includes('code')) throw e;
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
      // An assigned technician is freed by the status change itself, which also tells them (JOB_CANCELLED).
      await this.dispatch.withdrawOpen(tx, b.id);
      return { changed: true, result: marked };
    });
    if (refunded) this.payments.sendRefundsSoon(id);
    return this.core.get(customerId, id);
  }

  /**
   * The customer rates a finished visit (COMPLETED or CLOSED_NO_REPAIR), once. The technician's average and count are
   * recomputed from all their ratings in the same transaction (exact, never drifting), and so is the women-rated badge:
   * at least WOMEN_RATED_MIN ratings from customers who said "I'm a woman", averaging WOMEN_RATED_AVG stars or more.
   */
  async rate(customerId: string, id: string, input: { satisfied: boolean; stars: number; tags: string[]; comment: string; byWoman: boolean }): Promise<BookingDto> {
    await this.core.mutateOwned(customerId, id, async (tx, b) => {
      if (b.status !== 'COMPLETED' && b.status !== 'CLOSED_NO_REPAIR') throw new AppError('CONFLICT', {}, 'only a finished visit can be rated');
      if (await tx.rating.findUnique({ where: { bookingId: b.id }, select: { bookingId: true } })) throw new AppError('CONFLICT', {}, 'already rated');
      await tx.rating.create({ data: { bookingId: b.id, customerId, technicianId: b.technicianId, ...input, createdAt: this.core.now() } });
      if (b.technicianId) {
        await tx.$executeRaw`
          UPDATE technicians t SET rating_count = r.n, rating_avg = r.avg,
            women_rated = (r.women_n >= ${WOMEN_RATED_MIN} AND r.women_avg >= ${WOMEN_RATED_AVG})
          FROM (
            SELECT COUNT(*)::int AS n, ROUND(AVG(stars)::numeric, 2) AS avg,
                   COUNT(*) FILTER (WHERE by_woman)::int AS women_n, COALESCE(AVG(stars) FILTER (WHERE by_woman), 0)::float AS women_avg
            FROM ratings WHERE technician_id = ${b.technicianId}::uuid
          ) r
          WHERE t.user_id = ${b.technicianId}::uuid`;
      }
      return { changed: true, result: undefined };
    });
    return this.core.get(customerId, id);
  }

  /** New time for a booking still searching, unfulfilled or assigned: it goes back to MATCHING. */
  async reschedule(customerId: string, id: string, time: VisitTime): Promise<BookingDto> {
    await this.core.mutateOwned(customerId, id, async (tx, b) => {
      if (!RESCHEDULABLE.includes(b.status)) throw new AppError('CONFLICT');
      await this.slots.hold(tx, { categoryId: b.categoryId, pincode: b.pincode }, time, b.id);
      await this.dispatch.withdrawOpen(tx, b.id);
      // A fresh search; a previously assigned technician is released (and told: JOB_CANCELLED).
      await this.core.transition(
        tx,
        b,
        'MATCHING',
        { ...windowFields(time), technician: { disconnect: true }, assignedAt: null, matchingStartedAt: this.core.now(), etaMin: null },
        { type: 'CUSTOMER', id: customerId },
        { rescheduled: true },
      );
      return { changed: true, result: undefined };
    });
    await this.dispatch.offerNext(id);
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

  /**
   * "Book the same technician again": the technician of the customer's own earlier booking, once a visit took place
   * (completed, or closed without a repair). Anything else is a VALIDATION error on repeatOf: only someone the customer
   * has met can be asked for, so no technician can be targeted by id.
   */
  private async repeatTechnician(customerId: string, bookingId: string): Promise<string> {
    const earlier = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId, status: { in: ['COMPLETED', 'CLOSED_NO_REPAIR'] }, technicianId: { not: null } },
      select: { technicianId: true },
    });
    if (!earlier?.technicianId) throw validation('repeatOf');
    return earlier.technicianId;
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
