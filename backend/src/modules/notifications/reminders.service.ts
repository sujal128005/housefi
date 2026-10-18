// Reminders, swept every minute (reminders.worker.ts), each sent once per booking: the claim (a booking_reminders row)
// and the notice are written in one transaction, so two instances never send the same one twice.
// - PAY: the visit fee is still unpaid 10 minutes before the booking expires.
// - SOON: a scheduled visit starts within the hour (customer and technician).
// - QUOTE: a repair or extra-work quote has waited 10 minutes for an answer (the technician is at the door).
// - RATE: a completed visit is still unrated 2 hours later (once, and not after 2 days).
import { Injectable } from '@nestjs/common';
import type { BookingStatus, NotificationKind, Prisma } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { istDate, windowStartMs } from '../slots/slot-rules';
import { type Notice, Notifier } from './notifier';

const MIN = 60_000;
export const PAY_REMINDER_BEFORE_EXPIRY_MIN = 10;
export const SOON_REMINDER_BEFORE_MIN = 60;
export const QUOTE_REMINDER_AFTER_MIN = 10;
/** A quote older than this is a support matter, not a reminder. */
const QUOTE_REMINDER_UNTIL_MIN = 120;
export const RATE_REMINDER_AFTER_MIN = 120;
const RATE_REMINDER_UNTIL_MIN = 48 * 60;
const BATCH = 200;

interface Due {
  readonly bookingId: string;
  readonly key: string;
  readonly notices: readonly Notice[];
}

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: Notifier,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** Sends what is due now. Returns how many reminders were sent. */
  async sweep(): Promise<number> {
    const due = [...(await this.unpaid()), ...(await this.soon()), ...(await this.quotes()), ...(await this.unrated())];
    let sent = 0;
    for (const d of due) if (await this.send(d)) sent++;
    return sent;
  }

  private async send(d: Due): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        INSERT INTO booking_reminders (booking_id, key, sent_at) VALUES (${d.bookingId}::uuid, ${d.key}, ${new Date(this.clock.now())})
        ON CONFLICT DO NOTHING`;
      if (claimed === 0) return false;
      await this.notifier.enqueue(tx, d.notices);
      return true;
    });
  }

  private notice(userId: string, kind: NotificationKind, bookingId: string, params: Notice['params']): Notice {
    return { userId, kind, bookingId, params };
  }

  /** Not yet reminded: no booking_reminders row with this key. */
  private notSent(key: string): Prisma.BookingWhereInput {
    return { reminders: { none: { key } } };
  }

  private async unpaid(): Promise<Due[]> {
    const expiry = this.config.UNPAID_BOOKING_EXPIRY_MIN;
    if (expiry <= PAY_REMINDER_BEFORE_EXPIRY_MIN) return [];
    const now = this.clock.now();
    const rows = await this.prisma.booking.findMany({
      where: {
        status: 'AWAITING_PAYMENT',
        createdAt: { lte: new Date(now - (expiry - PAY_REMINDER_BEFORE_EXPIRY_MIN) * MIN), gt: new Date(now - expiry * MIN) },
        ...this.notSent('PAY'),
      },
      select: { id: true, code: true, customerId: true, createdAt: true },
      take: BATCH,
    });
    return rows.map((b) => {
      const minutes = Math.max(1, Math.ceil((b.createdAt.getTime() + expiry * MIN - now) / MIN));
      return { bookingId: b.id, key: 'PAY', notices: [this.notice(b.customerId, 'PAY_REMINDER', b.id, { code: b.code, minutes })] };
    });
  }

  private async soon(): Promise<Due[]> {
    const now = this.clock.now();
    // The window can start today or (just after midnight) tomorrow, IST.
    const days = [...new Set([istDate(now), istDate(now + SOON_REMINDER_BEFORE_MIN * MIN)])].map((d) => new Date(`${d}T00:00:00Z`));
    const rows = await this.prisma.booking.findMany({
      where: { status: 'ASSIGNED', windowDate: { in: days }, windowStartHour: { not: null }, technicianId: { not: null }, ...this.notSent('SOON') },
      select: { id: true, code: true, customerId: true, technicianId: true, windowDate: true, windowStartHour: true },
      take: BATCH,
    });
    return rows
      .filter((b) => {
        const start = windowStartMs(b.windowDate!.toISOString().slice(0, 10), b.windowStartHour!);
        return start > now && start - now <= SOON_REMINDER_BEFORE_MIN * MIN;
      })
      .map((b) => {
        const params = { code: b.code, startHour: b.windowStartHour! };
        return {
          bookingId: b.id,
          key: 'SOON',
          notices: [this.notice(b.customerId, 'BOOKING_REMINDER', b.id, params), this.notice(b.technicianId!, 'JOB_REMINDER', b.id, params)],
        };
      });
  }

  private async quotes(): Promise<Due[]> {
    const now = this.clock.now();
    const waiting: BookingStatus[] = ['QUOTE_SHARED', 'EXTRA_WORK'];
    // The event that moved the booking into its current status: a revised quote is a new event, so a new reminder.
    const events = await this.prisma.$queryRaw<{ booking_id: string; event_id: bigint; code: string; customer_id: string; at: Date }[]>`
      SELECT DISTINCT ON (b.id) b.id::text AS booking_id, e.id AS event_id, b.code, b.customer_id::text AS customer_id, e.at
      FROM bookings b JOIN booking_events e ON e.booking_id = b.id AND e.status = b.status
      WHERE b.status::text = ANY(${waiting}::text[])
      ORDER BY b.id, e.at DESC, e.id DESC`;
    const due = events.filter((e) => now - e.at.getTime() >= QUOTE_REMINDER_AFTER_MIN * MIN && now - e.at.getTime() < QUOTE_REMINDER_UNTIL_MIN * MIN).slice(0, BATCH);
    const keys = due.map((e) => ({ bookingId: e.booking_id, key: `QUOTE:${e.event_id}` }));
    const sent = keys.length ? await this.prisma.bookingReminder.findMany({ where: { OR: keys }, select: { bookingId: true, key: true } }) : [];
    const done = new Set(sent.map((s) => `${s.bookingId}/${s.key}`));
    return due
      .filter((e) => !done.has(`${e.booking_id}/QUOTE:${e.event_id}`))
      .map((e) => ({ bookingId: e.booking_id, key: `QUOTE:${e.event_id}`, notices: [this.notice(e.customer_id, 'QUOTE_REMINDER', e.booking_id, { code: e.code })] }));
  }

  private async unrated(): Promise<Due[]> {
    const now = this.clock.now();
    const rows = await this.prisma.booking.findMany({
      where: {
        status: 'COMPLETED',
        rating: { is: null },
        events: { some: { status: 'COMPLETED', at: { lte: new Date(now - RATE_REMINDER_AFTER_MIN * MIN), gt: new Date(now - RATE_REMINDER_UNTIL_MIN * MIN) } } },
        ...this.notSent('RATE'),
      },
      select: { id: true, code: true, customerId: true },
      take: BATCH,
    });
    return rows.map((b) => ({ bookingId: b.id, key: 'RATE', notices: [this.notice(b.customerId, 'RATE_REMINDER', b.id, { code: b.code })] }));
  }
}
