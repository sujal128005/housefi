// Super admin: every booking, and every action on one: cancel (any time, with or without the visit-fee refund), send
// back to the search, give it to a chosen technician, mark it done, create one for a customer (the visit fee paid by
// the customer in the app, or waived by Housefi), and erase one (its personal content and chat; the money records
// stay). Changes go through the same booking core as the apps (history, notifications, earnings), as ADMIN, and
// anything outside the normal steps is marked forced. Every action is in the audit log.
import { Injectable } from '@nestjs/common';
import type { Booking, BookingStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.module';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { paiseToRupees } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.module';
import { MediaUrls } from '../../common/storage/object-store';
import { type Actor, BookingCore, UUID } from '../bookings/booking-core';
import { ACTIVE_STATUSES, TECH_ACTIVE } from '../bookings/booking-status';
import { BOOKING_INCLUDE, type BookingDto, toBookingDto } from '../bookings/booking-view';
import { BookingsService } from '../bookings/bookings.service';
import type { NewBooking } from '../bookings/bookings.schemas';
import { DispatchService } from '../dispatch/dispatch.service';
import { PaymentsService } from '../payments/payments.service';
import { UploadsService } from '../uploads/uploads.service';

const FINAL: readonly BookingStatus[] = ['COMPLETED', 'CLOSED_NO_REPAIR', 'CANCELLED'];
const SEARCHING: readonly BookingStatus[] = ['MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED'];
const PAGE = 50;

export interface AdminBookingRow {
  readonly id: string;
  readonly code: string;
  readonly status: BookingStatus;
  readonly serviceId: string;
  readonly categoryId: string;
  readonly customer: { readonly id: string; readonly name: string };
  readonly technician: { readonly id: string; readonly name: string } | null;
  readonly area: string;
  readonly createdAt: number;
  readonly time: { readonly mode: 'INSTANT' | 'SCHEDULED'; readonly date: string | null; readonly startHour: number | null };
  readonly visitFee: { readonly amount: number; readonly state: string } | null;
  readonly demo: boolean;
}

export interface AdminBookingDetail {
  readonly booking: BookingDto;
  readonly customer: { readonly id: string; readonly name: string; readonly phone: string };
  readonly technician: { readonly id: string; readonly name: string; readonly phone: string } | null;
  readonly events: readonly { readonly status: BookingStatus; readonly actorType: string; readonly at: number; readonly forced: boolean }[];
  readonly offers: readonly { readonly technicianId: string; readonly state: string; readonly at: number }[];
  readonly tickets: readonly { readonly id: string; readonly kind: string; readonly state: string; readonly note: string; readonly at: number }[];
  readonly chatMessages: number;
  /** What the portal may do now. */
  readonly can: { readonly cancel: boolean; readonly sendBack: boolean; readonly assign: boolean; readonly complete: boolean; readonly waiveFee: boolean };
}

export type AdminActor = Actor & { readonly type: 'ADMIN'; readonly id: string; readonly ip: string };

@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: BookingCore,
    private readonly bookings: BookingsService,
    private readonly dispatch: DispatchService,
    private readonly payments: PaymentsService,
    private readonly uploads: UploadsService,
    private readonly cipher: FieldCipher,
    private readonly media: MediaUrls,
    private readonly audit: AuditService,
  ) {}

  async list(q: { status?: 'ACTIVE' | 'SEARCHING' | 'FINISHED' | 'CANCELLED' | 'ALL'; search?: string; page?: number }): Promise<{ rows: AdminBookingRow[]; total: number }> {
    const where: Prisma.BookingWhereInput = {
      ...(q.status === 'ACTIVE' ? { status: { in: [...ACTIVE_STATUSES] } } : {}),
      ...(q.status === 'SEARCHING' ? { status: { in: [...SEARCHING] } } : {}),
      ...(q.status === 'FINISHED' ? { status: { in: ['COMPLETED', 'CLOSED_NO_REPAIR'] } } : {}),
      ...(q.status === 'CANCELLED' ? { status: 'CANCELLED' } : {}),
      ...(q.search ? { code: { contains: q.search.trim().toUpperCase() } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: Math.max(0, (q.page ?? 0) * PAGE),
        take: PAGE,
        include: { customer: true, technician: { include: { user: true } }, payments: { where: { kind: 'VISIT' }, orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
      this.prisma.booking.count({ where }),
    ]);
    const name = async (enc: Uint8Array | null) => (enc ? await this.cipher.decrypt('users.name', enc) : '');
    const out: AdminBookingRow[] = [];
    for (const b of rows) {
      const visit = b.payments[0];
      out.push({
        id: b.id,
        code: b.code,
        status: b.status,
        serviceId: b.serviceId,
        categoryId: b.categoryId,
        customer: { id: b.customerId, name: await name(b.customer.nameEnc) },
        technician: b.technician ? { id: b.technician.userId, name: await name(b.technician.user.nameEnc) } : null,
        area: `${b.locality ?? ''}${b.locality ? ', ' : ''}${b.city} ${b.pincode}`.trim(),
        createdAt: b.createdAt.getTime(),
        time: { mode: b.timeMode, date: b.windowDate ? b.windowDate.toISOString().slice(0, 10) : null, startHour: b.windowStartHour },
        visitFee: visit ? { amount: paiseToRupees(visit.amountPaise), state: visit.provider === 'WAIVED' ? 'WAIVED' : visit.state } : null,
        demo: b.isDemo,
      });
    }
    return { rows: out, total };
  }

  async detail(id: string): Promise<AdminBookingDetail> {
    const b = await this.prisma.booking.findUnique({ where: { id: this.uuid(id) }, include: { ...BOOKING_INCLUDE, customer: true, offers: { orderBy: { createdAt: 'desc' }, take: 20 }, tickets: { orderBy: { createdAt: 'desc' } } } });
    if (!b) throw new AppError('NOT_FOUND');
    const dto = await toBookingDto(b, this.cipher, this.media);
    const phone = (enc: Uint8Array) => (enc.length ? this.cipher.decrypt('users.phone', enc) : Promise.resolve(''));
    const name = (enc: Uint8Array | null) => (enc ? this.cipher.decrypt('users.name', enc) : Promise.resolve(''));
    const chatMessages = await this.prisma.chatMessage.count({ where: { bookingId: b.id } });
    const visit = b.payments.filter((p) => p.kind === 'VISIT').at(-1);
    return {
      booking: dto,
      customer: { id: b.customerId, name: await name(b.customer.nameEnc), phone: await phone(b.customer.phoneEnc) },
      technician: b.technician ? { id: b.technician.userId, name: await name(b.technician.user.nameEnc), phone: await phone(b.technician.user.phoneEnc) } : null,
      events: b.events.map((e) => ({ status: e.status, actorType: e.actorType, at: e.at.getTime(), forced: (e.meta as { forced?: boolean } | null)?.forced === true })),
      offers: b.offers.map((o) => ({ technicianId: o.technicianId, state: o.state, at: o.createdAt.getTime() })),
      tickets: b.tickets.map((t) => ({ id: t.id, kind: t.kind, state: t.state, note: t.note, at: t.createdAt.getTime() })),
      chatMessages,
      can: {
        cancel: !FINAL.includes(b.status),
        sendBack: ['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(b.status),
        assign: SEARCHING.includes(b.status),
        complete: ['ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK', 'PAYMENT_DUE'].includes(b.status),
        waiveFee: b.status === 'AWAITING_PAYMENT' && visit?.state !== 'PAID',
      },
    };
  }

  /** Cancels at any stage; refunds the visit fee when asked (and it was paid). The customer and technician are told. */
  async cancel(id: string, refund: boolean, note: string, by: AdminActor): Promise<void> {
    let refunded = false;
    await this.locked(id, async (tx, b) => {
      if (FINAL.includes(b.status)) throw new AppError('CONFLICT', {}, `the booking is already ${b.status}`);
      await this.core.transition(tx, b, 'CANCELLED', { cancelReason: 'BY_HOUSEFI', etaMin: null }, by, { refund, note: note.slice(0, 200) }, { force: true });
      if (refund) refunded = await this.payments.refundVisitFee(tx, b.id, this.core.now());
      await this.dispatch.withdrawOpen(tx, b.id);
    });
    if (refunded) this.payments.sendRefundsSoon(id);
    await this.log(by, 'admin.booking_cancel', id, { refund: String(refund), note: note.slice(0, 200) });
  }

  /** Takes the job from its technician and searches again (the next technician is offered at once). */
  async sendBack(id: string, by: AdminActor): Promise<void> {
    await this.locked(id, async (tx, b) => {
      if (!['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(b.status)) throw new AppError('CONFLICT', {}, 'only while a technician has it and has not started work');
      await this.core.transition(tx, b, 'MATCHING', { technician: { disconnect: true }, assignedAt: null, etaMin: null, matchingStartedAt: this.core.now() }, by, { reassigned: true, previousTechnicianId: b.technicianId }, { force: true });
    });
    await this.dispatch.offerNext(id);
    await this.log(by, 'admin.booking_send_back', id);
  }

  /** Gives a searching job to this technician directly (they are told; they must be approved and free). */
  async assign(id: string, technicianId: string, by: AdminActor): Promise<void> {
    await this.locked(id, async (tx, b) => {
      if (!SEARCHING.includes(b.status)) throw new AppError('CONFLICT', {}, 'only while searching');
      const tech = await tx.technician.findUnique({ where: { userId: this.uuid(technicianId) } });
      if (!tech || tech.verification !== 'APPROVED') throw new AppError('CONFLICT', {}, 'the technician is not approved');
      if (await tx.booking.count({ where: { technicianId: tech.userId, status: { in: [...TECH_ACTIVE] } } })) throw new AppError('CONFLICT', {}, 'the technician is on another job');
      await this.dispatch.withdrawOpen(tx, b.id);
      const now = this.core.now();
      await tx.jobOffer.create({ data: { bookingId: b.id, technicianId: tech.userId, channel: 'APP', state: 'ACCEPTED', createdAt: now, expiresAt: new Date(now.getTime() + 1000), respondedAt: now } });
      await this.core.transition(tx, b, 'ASSIGNED', { technician: { connect: { userId: tech.userId } }, assignedAt: now }, by, { assignedBy: 'admin' }, { force: true });
    });
    await this.log(by, 'admin.booking_assign', id, { technicianId });
  }

  /** Marks a job done (finished outside the app): earnings are written as for any completed job. */
  async complete(id: string, by: AdminActor): Promise<void> {
    await this.locked(id, async (tx, b) => {
      if (!['ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK', 'PAYMENT_DUE'].includes(b.status)) throw new AppError('CONFLICT', {}, 'only once the technician is there');
      await this.core.transition(tx, b, 'COMPLETED', { etaMin: null }, by, { completedBy: 'admin' }, { force: true });
    });
    await this.log(by, 'admin.booking_complete', id);
  }

  /** Housefi pays the visit fee: the booking starts searching without the customer paying. Not counted as revenue. */
  async waiveVisitFee(id: string, by: AdminActor): Promise<void> {
    await this.locked(id, async (tx, b) => {
      if (b.status !== 'AWAITING_PAYMENT') throw new AppError('CONFLICT', {}, 'only before the visit fee is paid');
      const now = this.core.now();
      await tx.payment.updateMany({ where: { bookingId: b.id, kind: 'VISIT', state: { in: ['DUE', 'FAILED'] } }, data: { state: 'PAID', provider: 'WAIVED', settledAt: now } });
      await this.core.transition(tx, b, 'MATCHING', { matchingStartedAt: now }, by, { visitFee: 'waived' });
    });
    await this.dispatch.offerNext(id);
    await this.log(by, 'admin.booking_waive_fee', id);
  }

  /** A booking for a customer (e.g. one who phoned): one of their saved addresses; the fee paid in the app, or waived. */
  async create(customerId: string, input: NewBooking, waiveFee: boolean, by: AdminActor): Promise<{ id: string; code: string }> {
    const customer = await this.prisma.user.findFirst({ where: { id: this.uuid(customerId), role: 'CUSTOMER', status: 'ACTIVE' } });
    if (!customer) throw new AppError('NOT_FOUND', {}, 'no such customer');
    const { booking } = await this.bookings.create(customer.id, `admin-${randomUUID()}`, input);
    await this.log(by, 'admin.booking_create', booking.id, { customerId: customer.id, waiveFee: String(waiveFee) });
    if (waiveFee) await this.waiveVisitFee(booking.id, by);
    return { id: booking.id, code: booking.code };
  }

  /**
   * Erases a booking's personal content: the address, notes, voice note and photos, and its chat. It is cancelled
   * first if still running. Payments, earnings and the history stay (money records must be kept).
   */
  async erase(id: string, by: AdminActor): Promise<void> {
    const b0 = await this.prisma.booking.findUnique({ where: { id: this.uuid(id) }, select: { status: true } });
    if (!b0) throw new AppError('NOT_FOUND');
    if (!FINAL.includes(b0.status)) await this.cancel(id, false, 'erased by Housefi', by);
    const photos = await this.prisma.$transaction(async (tx) => {
      const ups = await tx.upload.findMany({ where: { bookingId: id }, select: { id: true } });
      await tx.chatMessage.deleteMany({ where: { bookingId: id } });
      await tx.notification.deleteMany({ where: { bookingId: id, kind: 'CHAT_MESSAGE' } });
      await tx.upload.deleteMany({ where: { bookingId: id } });
      await tx.booking.update({ where: { id }, data: { addressSnapshotEnc: new Uint8Array(0), notes: '', voiceTranscript: null, issueIds: [] } });
      return ups.map((u) => u.id);
    });
    await this.uploads.deleteObjects(photos);
    await this.log(by, 'admin.booking_erase', id, { files: String(photos.length) });
  }

  private async locked(id: string, fn: (tx: Prisma.TransactionClient, b: Booking) => Promise<void>): Promise<void> {
    const bookingId = this.uuid(id);
    await this.prisma.$transaction(async (tx) => {
      const b = await this.core.lock(tx, bookingId);
      if (!b) throw new AppError('NOT_FOUND');
      await fn(tx, b);
    });
    this.core.updates.publish(bookingId);
  }

  private uuid(id: string): string {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    return id;
  }

  private async log(by: AdminActor, action: string, bookingId: string, after: Record<string, string> = {}): Promise<void> {
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action, entity: 'booking', entityId: bookingId, after, ip: by.ip });
  }
}
