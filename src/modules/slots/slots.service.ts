import { Injectable } from '@nestjs/common';
import type { CategoryId, Prisma } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { HOLDS_SLOT } from '../bookings/booking-status';
import { istHour, type Slot, slotsFor } from './slot-rules';

type Db = Prisma.TransactionClient | PrismaService;

export type RequestedTime = { mode: 'INSTANT'; window: null } | { mode: 'SCHEDULED'; window: { date: string; startHour: number; endHour: number } };

export interface Area {
  readonly categoryId: CategoryId;
  readonly pincode: string;
}

@Injectable()
export class SlotsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /**
   * The six windows of `date` for a service. Capacity is per category and PIN area: pass the PIN of the address the
   * customer picked to get that area's FULL windows; without a PIN the default capacity applies.
   */
  async slots(serviceId: string, date: string, pincode?: string): Promise<Slot[]> {
    const service = await this.prisma.service.findFirst({ where: { id: serviceId, active: true }, select: { categoryId: true } });
    if (!service) throw new AppError('NOT_FOUND');
    const capacity = await this.capacity(this.prisma, service.categoryId, pincode);
    const booked = pincode ? await this.bookedPerWindow(this.prisma, { categoryId: service.categoryId, pincode }, date) : new Map<number, number>();
    return slotsFor({ date, nowMs: this.clock.now(), capacity, booked });
  }

  /**
   * Checks that a booking may take `time` in `area`, inside the caller's transaction. Instant visits: only within
   * INSTANT_HOURS (IST). Scheduled: the window must be OPEN. A per-window advisory lock is held until the
   * transaction ends, so two bookings cannot both take the last place in a window.
   */
  async hold(tx: Prisma.TransactionClient, area: Area, time: RequestedTime, excludeBookingId?: string): Promise<void> {
    const now = this.clock.now();
    if (time.mode === 'INSTANT') {
      const [from, to] = this.config.INSTANT_HOURS;
      const hour = istHour(now);
      if (hour < from || hour >= to) throw new AppError('INSTANT_UNAVAILABLE');
      return;
    }
    const w = time.window;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`slot:${area.categoryId}:${area.pincode}:${w.date}:${w.startHour}`}, 0))`;
    const capacity = await this.capacity(tx, area.categoryId, area.pincode);
    const booked = await this.bookedPerWindow(tx, area, w.date, excludeBookingId);
    const slot = slotsFor({ date: w.date, nowMs: now, capacity, booked }).find((s) => s.startHour === w.startHour);
    if (!slot || slot.state !== 'OPEN') throw new AppError('SLOT_UNAVAILABLE');
  }

  private async capacity(db: Db, categoryId: CategoryId, pincode: string | undefined): Promise<number> {
    if (pincode) {
      const row = await db.slotCapacity.findUnique({ where: { categoryId_pincode: { categoryId, pincode } } });
      if (row) return row.maxPerWindow;
    }
    return this.config.SLOT_CAPACITY_PER_WINDOW;
  }

  /** Scheduled bookings holding each window of `date` in the area, by start hour. */
  private async bookedPerWindow(db: Db, area: Area, date: string, excludeBookingId?: string): Promise<Map<number, number>> {
    const rows = await db.booking.groupBy({
      by: ['windowStartHour'],
      where: {
        categoryId: area.categoryId,
        pincode: area.pincode,
        timeMode: 'SCHEDULED',
        windowDate: new Date(`${date}T00:00:00Z`),
        status: { in: [...HOLDS_SLOT] },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      _count: { _all: true },
    });
    return new Map(rows.filter((r) => r.windowStartHour !== null).map((r) => [r.windowStartHour as number, r._count._all]));
  }
}
