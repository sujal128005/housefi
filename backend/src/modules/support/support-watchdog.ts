// The STATE-MACHINE.md timeouts that need a person rather than a status change: a trip running 30 minutes past its
// ETA, and a bill still unpaid 24 hours after the repair. Each opens one support ticket per booking.
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';

/** EN_ROUTE: alert support when the trip takes this much longer than the ETA given at the start. */
export const TRIP_GRACE_MIN = 30;
/** PAYMENT_DUE: a support ticket when the bill is still unpaid this long after the repair. */
export const BILL_UNPAID_HOURS = 24;
const MIN = 60_000;

@Injectable()
export class SupportWatchdog {
  private readonly log = new Logger(SupportWatchdog.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  async sweep(): Promise<{ tripsOverdue: number; billsUnpaid: number }> {
    const now = this.clock.now();
    let tripsOverdue = 0;
    let billsUnpaid = 0;
    const trips = await this.prisma.booking.findMany({
      where: { status: 'EN_ROUTE' },
      select: { id: true, events: { where: { status: 'EN_ROUTE' }, orderBy: { at: 'desc' }, take: 1 } },
      take: 200,
    });
    for (const t of trips) {
      const started = t.events[0];
      if (!started) continue;
      const eta = Number((started.meta as Prisma.JsonObject | null)?.etaMin ?? 0) || 0;
      if (now < started.at.getTime() + (eta + TRIP_GRACE_MIN) * MIN) continue;
      if (await this.ticketOnce(t.id, 'EN_ROUTE', 'TRIP_OVERDUE', 'HIGH', `Trip started ${Math.round((now - started.at.getTime()) / MIN)} min ago; ETA was ${eta} min.`)) tripsOverdue++;
    }
    const bills = await this.prisma.booking.findMany({
      where: { status: 'PAYMENT_DUE', events: { some: { status: 'PAYMENT_DUE', at: { lte: new Date(now - BILL_UNPAID_HOURS * 60 * MIN) } } } },
      select: { id: true },
      take: 200,
    });
    for (const b of bills) {
      if (await this.ticketOnce(b.id, 'PAYMENT_DUE', 'BILL_UNPAID', 'HIGH', `Bill unpaid for more than ${BILL_UNPAID_HOURS} h.`)) billsUnpaid++;
    }
    return { tripsOverdue, billsUnpaid };
  }

  /**
   * Opens the ticket unless the booking already has one of this kind, under the booking's row lock (so two instances
   * never open two). System tickets name the booking's customer as raiser: they are the one waiting.
   */
  private async ticketOnce(bookingId: string, status: 'EN_ROUTE' | 'PAYMENT_DUE', kind: string, priority: 'HIGH', note: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
      const b = await tx.booking.findUnique({ where: { id: bookingId }, select: { status: true, code: true, customerId: true } });
      if (b?.status !== status) return false;
      if (await tx.supportTicket.findFirst({ where: { bookingId, kind }, select: { id: true } })) return false;
      await tx.supportTicket.create({ data: { bookingId, raisedBy: b.customerId, kind, note, priority, createdAt: new Date(this.clock.now()) } });
      this.log.warn(`${priority} ${kind} ticket on booking ${b.code}`);
      return true;
    });
  }
}

/** Runs the watchdog every minute (not in tests, which call sweep() with a test clock). Safe on every instance. */
@Injectable()
export class SupportWatchdogWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(SupportWatchdogWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly watchdog: SupportWatchdog,
    @InjectConfig() private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), MIN);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.watchdog.sweep();
    } catch (err) {
      this.log.warn(`support watchdog failed (${(err as Error).message})`);
    } finally {
      this.running = false;
    }
  }
}
