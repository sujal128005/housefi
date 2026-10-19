// The super admin dashboard's numbers: today, this week, and what needs attention now. Read-only.
import { Injectable } from '@nestjs/common';
import { type Clock, InjectClock } from '../../common/clock';
import { paiseToRupees } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.module';
import { ACTIVE_STATUSES } from '../bookings/booking-status';
import { istDayStart } from '../slots/slot-rules';

const DAY = 24 * 60 * 60_000;

export interface OverviewDto {
  readonly today: { readonly bookings: number; readonly completed: number; readonly revenue: number };
  readonly week: { readonly bookings: number; readonly completed: number; readonly revenue: number; readonly newCustomers: number };
  readonly now: { readonly activeBookings: number; readonly searching: number; readonly techniciansOnline: number };
  readonly people: { readonly customers: number; readonly technicians: number; readonly approved: number; readonly waitingReview: number };
  readonly attention: { readonly openSos: number; readonly openReports: number; readonly openQueries: number };
  /** Average stars of the last 30 days; null without ratings. */
  readonly rating: number | null;
  /** Bookings created per day, the last 14 days, oldest first ("YYYY-MM-DD" in India). */
  readonly daily: readonly { readonly date: string; readonly bookings: number; readonly completed: number; readonly revenue: number }[];
}

@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  async overview(): Promise<OverviewDto> {
    const now = this.clock.now();
    const today = new Date(istDayStart(now));
    const week = new Date(istDayStart(now) - 6 * DAY);
    const fortnight = new Date(istDayStart(now) - 13 * DAY);
    const db = this.prisma;
    const paid = (from: Date) => db.payment.aggregate({ where: { state: 'PAID', settledAt: { gte: from }, booking: { isDemo: false } }, _sum: { amountPaise: true } });
    const done = (from: Date) => db.bookingEvent.count({ where: { status: 'COMPLETED', at: { gte: from } } });
    const [bToday, bWeek, cToday, cWeek, rToday, rWeek, newCustomers, active, searching, online, customers, technicians, approved, waiting, sos, reports, queries, rating, daily] = await Promise.all([
      db.booking.count({ where: { createdAt: { gte: today } } }),
      db.booking.count({ where: { createdAt: { gte: week } } }),
      done(today),
      done(week),
      paid(today),
      paid(week),
      db.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: week } } }),
      db.booking.count({ where: { status: { in: [...ACTIVE_STATUSES] } } }),
      db.booking.count({ where: { status: { in: ['MATCHING', 'MATCHING_DELAYED'] } } }),
      db.technician.count({ where: { online: true } }),
      db.user.count({ where: { role: 'CUSTOMER', status: 'ACTIVE' } }),
      db.technician.count(),
      db.technician.count({ where: { verification: 'APPROVED' } }),
      db.technician.count({ where: { verification: 'PENDING' } }),
      db.supportTicket.count({ where: { state: 'OPEN', kind: 'UNSAFE' } }),
      db.supportTicket.count({ where: { state: 'OPEN', kind: { notIn: ['UNSAFE', 'CALLBACK'] } } }),
      db.supportTicket.count({ where: { state: 'OPEN', kind: 'CALLBACK' } }),
      db.rating.aggregate({ where: { createdAt: { gte: new Date(now - 30 * DAY) } }, _avg: { stars: true } }),
      db.$queryRaw<{ date: string; bookings: bigint; completed: bigint; revenue: bigint }[]>`
        WITH days AS (SELECT generate_series(0, 13) AS n)
        SELECT to_char((${fortnight}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date + n, 'YYYY-MM-DD') AS date,
          (SELECT count(*) FROM bookings b WHERE (b.created_at AT TIME ZONE 'Asia/Kolkata')::date = (${fortnight}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date + n) AS bookings,
          (SELECT count(*) FROM booking_events e WHERE e.status = 'COMPLETED' AND (e.at AT TIME ZONE 'Asia/Kolkata')::date = (${fortnight}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date + n) AS completed,
          (SELECT COALESCE(sum(p.amount_paise), 0) FROM payments p JOIN bookings pb ON pb.id = p.booking_id
             WHERE p.state = 'PAID' AND NOT pb.is_demo AND (p.settled_at AT TIME ZONE 'Asia/Kolkata')::date = (${fortnight}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date + n)::bigint AS revenue
        FROM days ORDER BY n`,
    ]);
    const rupees = (a: { _sum: { amountPaise: bigint | null } }) => paiseToRupees(a._sum.amountPaise ?? 0n);
    return {
      today: { bookings: bToday, completed: cToday, revenue: rupees(rToday) },
      week: { bookings: bWeek, completed: cWeek, revenue: rupees(rWeek), newCustomers },
      now: { activeBookings: active, searching, techniciansOnline: online },
      people: { customers, technicians, approved, waitingReview: waiting },
      attention: { openSos: sos, openReports: reports, openQueries: queries },
      rating: rating._avg.stars === null ? null : Math.round(Number(rating._avg.stars) * 10) / 10,
      daily: daily.map((d) => ({ date: d.date, bookings: Number(d.bookings), completed: Number(d.completed), revenue: paiseToRupees(d.revenue) })),
    };
  }
}
