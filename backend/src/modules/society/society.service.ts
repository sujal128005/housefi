// Society repair day: an apartment society books one technician for the whole building on one day. The organiser plans
// the day (trade, date and window, the building's area); neighbours join by booking their flat with the day's code
// (POST /bookings with societyCode) and pay a lower visit fee. At the cutoff (the evening before) a day with
// SOCIETY_MIN_FLATS paid flats is confirmed and its first flat offered to technicians: the one who accepts gets every
// flat (dispatch.service assignSocietyFlats). With fewer flats, or no technician, every flat is cancelled and refunded.
// The technician earns the normal visit share per flat; Housefi pays the difference.
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { type Booking, type CategoryId, Prisma, type SocietyDay } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingCore } from '../bookings/booking-core';
import { REFUND_ON_CANCEL } from '../bookings/booking-status';
import { DispatchService } from '../dispatch/dispatch.service';
import { PaymentsService } from '../payments/payments.service';
import { istDate } from '../slots/slot-rules';
import { dayDate, HOLDING, newSocietyCode, PAID, SOCIETY_MAX_DAYS_AHEAD, SOCIETY_MIN_LEAD_MS, societyCutoffMs } from './society-rules';

/** openapi.yaml SocietyDay. */
export interface SocietyDayDto {
  readonly code: string;
  readonly name: string;
  readonly categoryId: CategoryId;
  /** The building's area (never a flat or a street). */
  readonly area: { readonly locality: string; readonly city: string; readonly pincode: string };
  readonly time: { readonly mode: 'SCHEDULED'; readonly window: { readonly date: string; readonly startHour: number; readonly endHour: number } };
  readonly state: SocietyDay['state'];
  /** Flats with the visit fee paid (they count towards minFlats). */
  readonly flats: number;
  /** Flats booked, paid or not yet. */
  readonly joined: number;
  readonly minFlats: number;
  readonly maxFlats: number;
  /** Each flat's visit fee, and the usual one (rupees). */
  readonly visitFee: number;
  readonly usualVisitFee: number;
  /** Joining closes and the day is decided at this instant (ms). */
  readonly cutoffAt: number;
  readonly organiser: boolean;
  /** The caller's own flat booking for this day, if any. */
  readonly myBookingId: string | null;
  readonly technician: { readonly name: string } | null;
}

const CODE_ATTEMPTS = 8;
const SYSTEM = { type: 'SYSTEM' as const, id: null };

@Injectable()
export class SocietyService {
  private readonly log = new Logger(SocietyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly core: BookingCore,
    private readonly dispatch: DispatchService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  async create(customerId: string, input: { name: string; categoryId: CategoryId; addressId: string; window: { date: string; startHour: number; endHour: number } }): Promise<SocietyDayDto> {
    const address = await this.prisma.address.findFirst({ where: { id: input.addressId, userId: customerId, deletedAt: null }, select: { locality: true, city: true, pincode: true } });
    if (!address) throw new AppError('VALIDATION', { fields: { addressId: 'INVALID' } });
    const now = this.clock.now();
    const today = Date.parse(`${istDate(now)}T00:00:00Z`);
    const date = Date.parse(`${input.window.date}T00:00:00Z`);
    const cutoff = societyCutoffMs(input.window.date, this.config.SOCIETY_CUTOFF_HOUR);
    if (date - today > SOCIETY_MAX_DAYS_AHEAD * 86_400_000 || cutoff - now < SOCIETY_MIN_LEAD_MS) throw new AppError('VALIDATION', { fields: { window: 'INVALID' } });
    if (!(await this.prisma.service.count({ where: { categoryId: input.categoryId, active: true } }))) throw new AppError('VALIDATION', { fields: { categoryId: 'INVALID' } });
    const isDemo = (await this.prisma.user.findUnique({ where: { id: customerId }, select: { isDemo: true } }))?.isDemo ?? false;
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      try {
        const day = await this.prisma.societyDay.create({
          data: {
            code: newSocietyCode(),
            organiserId: customerId,
            name: input.name,
            categoryId: input.categoryId,
            city: address.city,
            locality: address.locality,
            pincode: address.pincode,
            windowDate: new Date(`${input.window.date}T00:00:00Z`),
            windowStartHour: input.window.startHour,
            windowEndHour: input.window.endHour,
            isDemo,
            createdAt: new Date(now),
          },
        });
        await this.audit.record({ actorType: 'CUSTOMER', actorId: customerId, action: 'society.created', entity: 'society_day', entityId: day.id, after: { categoryId: day.categoryId, date: input.window.date } });
        return this.get(customerId, day.code);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    throw new AppError('CONFLICT', {}, 'try again');
  }

  /** Any signed-in customer with the code may look (the area, the date, how many flats; nobody's flat or name). */
  async get(customerId: string, code: string): Promise<SocietyDayDto> {
    const day = await this.prisma.societyDay.findUnique({ where: { code: code.trim().toUpperCase() }, include: { technician: { include: { user: true } } } });
    const isDemo = (await this.prisma.user.findUnique({ where: { id: customerId }, select: { isDemo: true } }))?.isDemo ?? false;
    if (!day || day.isDemo !== isDemo) throw new AppError('NOT_FOUND');
    return this.dto(customerId, day);
  }

  /** The days the customer planned or joined, newest first. */
  async mine(customerId: string): Promise<SocietyDayDto[]> {
    const days = await this.prisma.societyDay.findMany({
      where: { OR: [{ organiserId: customerId }, { flats: { some: { customerId } } }] },
      orderBy: { windowDate: 'desc' },
      take: 10,
      include: { technician: { include: { user: true } } },
    });
    return Promise.all(days.map((d) => this.dto(customerId, d)));
  }

  // ---------- the cutoff and after (society.worker) ----------

  async tick(): Promise<{ confirmed: number; cancelled: number; assigned: number }> {
    const now = this.clock.now();
    let confirmed = 0;
    let cancelled = 0;
    let assigned = 0;
    // 1) Open days at their cutoff: confirm with enough paid flats, otherwise cancel and refund.
    const soon = new Date(`${istDate(now + 2 * 86_400_000)}T00:00:00Z`);
    for (const d of await this.prisma.societyDay.findMany({ where: { state: 'OPEN', windowDate: { lte: soon } }, select: { id: true, windowDate: true } })) {
      if (now < societyCutoffMs(dayDate(d), this.config.SOCIETY_CUTOFF_HOUR)) continue;
      const r = await this.decide(d.id);
      if (r === 'CONFIRMED') confirmed++;
      if (r === 'CANCELLED') cancelled++;
    }
    // 2) Confirmed days: a lead flat that found nobody (or was cancelled) passes the day on or ends it.
    for (const d of await this.prisma.societyDay.findMany({ where: { state: 'CONFIRMED' }, select: { id: true } })) {
      if ((await this.followLead(d.id)) === 'CANCELLED') cancelled++;
    }
    // 3) Assigned days: flats paid after the technician accepted are theirs too.
    for (const d of await this.prisma.societyDay.findMany({ where: { state: 'ASSIGNED', technicianId: { not: null }, flats: { some: { status: { in: ['MATCHING', 'MATCHING_DELAYED'] }, technicianId: null } } }, select: { id: true, technicianId: true } })) {
      assigned += await this.prisma.$transaction((tx) => this.dispatch.assignSocietyFlats(tx, d.id, d.technicianId!, new Date(now)));
    }
    return { confirmed, cancelled, assigned };
  }

  private async decide(dayId: string): Promise<'CONFIRMED' | 'CANCELLED' | null> {
    const refunds: string[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      const day = await this.lockDay(tx, dayId);
      if (!day || day.state !== 'OPEN') return { outcome: null, lead: null };
      const paid = await tx.booking.findMany({ where: { societyDayId: day.id, status: { in: ['MATCHING', 'MATCHING_DELAYED'] } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      const now = new Date(this.clock.now());
      if (paid.length >= this.config.SOCIETY_MIN_FLATS) {
        const lead = paid[0]!.id;
        await tx.societyDay.update({ where: { id: day.id }, data: { state: 'CONFIRMED', leadBookingId: lead, decidedAt: now } });
        await tx.booking.update({ where: { id: lead }, data: { matchingStartedAt: now } });
        await this.audit.record({ actorType: 'SYSTEM', actorId: null, action: 'society.confirmed', entity: 'society_day', entityId: day.id, after: { flats: paid.length } }, tx);
        return { outcome: 'CONFIRMED' as const, lead };
      }
      refunds.push(...(await this.cancelFlats(tx, day.id, now)));
      await tx.societyDay.update({ where: { id: day.id }, data: { state: 'CANCELLED', decidedAt: now } });
      await this.audit.record({ actorType: 'SYSTEM', actorId: null, action: 'society.cancelled', entity: 'society_day', entityId: day.id, after: { flats: paid.length, reason: 'too few flats' } }, tx);
      return { outcome: 'CANCELLED' as const, lead: null };
    });
    for (const id of refunds) this.payments.sendRefundsSoon(id);
    if (result.lead) await this.dispatch.offerNext(result.lead);
    return result.outcome;
  }

  private async followLead(dayId: string): Promise<'CANCELLED' | null> {
    const refunds: string[] = [];
    const next = await this.prisma.$transaction(async (tx) => {
      const day = await this.lockDay(tx, dayId);
      if (!day || day.state !== 'CONFIRMED' || !day.leadBookingId) return { cancelled: false, lead: null };
      const lead = await tx.booking.findUnique({ where: { id: day.leadBookingId }, select: { status: true } });
      if (lead && (lead.status === 'MATCHING' || lead.status === 'MATCHING_DELAYED' || lead.status === 'ASSIGNED')) return { cancelled: false, lead: null };
      const now = new Date(this.clock.now());
      // The lead's customer cancelled their flat: the next paid flat leads (unless the search had already run out).
      const other = lead?.status === 'CANCELLED'
        ? await tx.booking.findFirst({ where: { societyDayId: day.id, status: { in: ['MATCHING', 'MATCHING_DELAYED'] } }, orderBy: { createdAt: 'asc' }, select: { id: true } })
        : null;
      if (other) {
        await tx.societyDay.update({ where: { id: day.id }, data: { leadBookingId: other.id } });
        await tx.booking.update({ where: { id: other.id }, data: { matchingStartedAt: now } });
        return { cancelled: false, lead: other.id };
      }
      refunds.push(...(await this.cancelFlats(tx, day.id, now)));
      await tx.societyDay.update({ where: { id: day.id }, data: { state: 'CANCELLED', decidedAt: now } });
      await this.audit.record({ actorType: 'SYSTEM', actorId: null, action: 'society.cancelled', entity: 'society_day', entityId: day.id, after: { reason: 'no technician' } }, tx);
      return { cancelled: true, lead: null };
    });
    for (const id of refunds) this.payments.sendRefundsSoon(id);
    if (next.lead) await this.dispatch.offerNext(next.lead);
    return next.cancelled ? 'CANCELLED' : null;
  }

  /** Cancels every flat still waiting (refunding paid visit fees, also an unfulfilled lead's); returns the refunded ids. */
  private async cancelFlats(tx: Prisma.TransactionClient, dayId: string, now: Date): Promise<string[]> {
    const flats = await tx.booking.findMany({ where: { societyDayId: dayId, status: { in: ['AWAITING_PAYMENT', 'PAYMENT_PENDING', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED'] } }, select: { id: true } });
    const refunded: string[] = [];
    for (const f of flats) {
      const b = await this.core.lock(tx, f.id);
      if (!b) continue;
      const refund = REFUND_ON_CANCEL.includes(b.status);
      await this.core.transition(tx, b as Booking, 'CANCELLED', { cancelReason: 'BY_HOUSEFI', etaMin: null }, SYSTEM, { refund, society: true });
      if (refund && (await this.payments.refundVisitFee(tx, b.id, now))) refunded.push(b.id);
      await this.dispatch.withdrawOpen(tx, b.id);
      this.core.updates.publish(b.id);
    }
    return refunded;
  }

  private async lockDay(tx: Prisma.TransactionClient, id: string): Promise<SocietyDay | null> {
    await tx.$queryRaw`SELECT id FROM society_days WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.societyDay.findUnique({ where: { id } });
  }

  private async dto(customerId: string, day: SocietyDay & { technician: { user: { nameEnc: Uint8Array | null } } | null }): Promise<SocietyDayDto> {
    const [flats, joined, mine, usual] = await Promise.all([
      this.prisma.booking.count({ where: { societyDayId: day.id, ...PAID } }),
      this.prisma.booking.count({ where: { societyDayId: day.id, ...HOLDING } }),
      this.prisma.booking.findFirst({ where: { societyDayId: day.id, customerId, ...HOLDING }, select: { id: true } }),
      this.prisma.service.findFirst({ where: { categoryId: day.categoryId, active: true }, orderBy: { visitFeePaise: 'asc' }, select: { visitFeePaise: true } }),
    ]);
    const techName = day.technician?.user.nameEnc ? await this.cipher.decrypt('users.name', day.technician.user.nameEnc) : null;
    return {
      code: day.code,
      name: day.name,
      categoryId: day.categoryId,
      area: { locality: day.locality, city: day.city, pincode: day.pincode.trim() },
      time: { mode: 'SCHEDULED', window: { date: dayDate(day), startHour: day.windowStartHour, endHour: day.windowEndHour } },
      state: day.state,
      flats,
      joined,
      minFlats: this.config.SOCIETY_MIN_FLATS,
      maxFlats: this.config.SOCIETY_MAX_FLATS,
      visitFee: this.config.SOCIETY_VISIT_FEE_RUPEES,
      usualVisitFee: usual ? Number(usual.visitFeePaise / 100n) : this.config.VISIT_FEE_RUPEES,
      cutoffAt: societyCutoffMs(dayDate(day), this.config.SOCIETY_CUTOFF_HOUR),
      organiser: day.organiserId === customerId,
      myBookingId: mine?.id ?? null,
      technician: techName ? { name: techName.split(/\s+/)[0] ?? techName } : null,
    };
  }
}

/** The cutoff and what follows, every minute. */
@Injectable()
export class SocietyWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(SocietyWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly society: SocietyService,
    @InjectConfig() private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return; // tests call tick() with a test clock
    this.timer = setInterval(() => void this.run(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.society.tick();
      if (r.confirmed + r.cancelled + r.assigned > 0) this.log.log(`society days: ${JSON.stringify(r)}`);
    } catch (err) {
      this.log.warn(`society sweep failed (${(err as Error).message}); retrying`);
    } finally {
      this.running = false;
    }
  }
}
