import { Injectable } from '@nestjs/common';
import { type PayoutState, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { istDate, istDayStart } from '../slots/slot-rules';
import { nextPayoutOn, payoutCutoff, rupees, WEEKS_SHOWN, type WeekSummary, weeklySummary } from './earnings-rules';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The earnings screen lists this many of the latest jobs. */
export const EARNINGS_ENTRIES_LIMIT = 50;
/** What a job earns (credits); cash collected and payouts are what is netted against them. */
const JOB_CREDITS = Prisma.sql`('VISIT_SHARE', 'LABOUR_SHARE', 'MATERIAL_REIMBURSE')`;

/** openapi.yaml Earnings. Whole rupees. */
export interface EarningsDto {
  /** Earned today (IST) on jobs, before cash is netted. */
  readonly today: number;
  readonly jobsToday: number;
  /** Earned since joining (jobs and adjustments). */
  readonly total: number;
  /** The balance not paid out yet: earnings minus cash collected minus payouts made. Negative when the technician owes. */
  readonly pendingPayout: number;
  readonly nextPayoutOn: string;
  readonly entries: readonly {
    readonly jobId: string;
    readonly code: string;
    readonly serviceId: string;
    /** What the job earned (credits only; cash collected on it is netted in the payout). */
    readonly amount: number;
    readonly at: number;
    readonly payout: 'PENDING' | 'PAID';
  }[];
  /** This week and the ones before it, newest first, with what happened to each week's payout. */
  readonly weeks: readonly WeekSummary[];
}

export interface PayoutActor {
  readonly type: 'ADMIN';
  /** Null for the command line (who ran it is in `via`). */
  readonly id: string | null;
  /** e.g. 'cli:asha'. */
  readonly via: string;
}

export interface PayoutRow {
  readonly id: string;
  readonly technicianId: string;
  readonly technicianName: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amount: number;
  readonly state: PayoutState;
  readonly providerRef: string | null;
}

/**
 * The technician's earnings summary, and the weekly payout run (README §10: cash collected is netted in the weekly
 * payout every Monday). Payouts are prepared and marked paid by an admin with `npm run payouts` until RazorpayX
 * automates the transfers.
 */
@Injectable()
export class EarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly audit: AuditService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  async summary(technicianId: string): Promise<EarningsDto> {
    const now = this.clock.now();
    const todayStart = new Date(istDayStart(now));
    const [sums] = await this.prisma.$queryRaw<{ total: bigint; today: bigint; jobs_today: bigint; balance: bigint }[]>`
      SELECT COALESCE(SUM(amount_paise) FILTER (WHERE type IN ${JOB_CREDITS} OR type = 'ADJUSTMENT'), 0)::bigint AS total,
             COALESCE(SUM(amount_paise) FILTER (WHERE type IN ${JOB_CREDITS} AND created_at >= ${todayStart}), 0)::bigint AS today,
             COUNT(DISTINCT booking_id) FILTER (WHERE type IN ${JOB_CREDITS} AND created_at >= ${todayStart}) AS jobs_today,
             COALESCE(SUM(amount_paise), 0)::bigint AS balance
      FROM earnings_ledger WHERE technician_id = ${technicianId}::uuid`;
    const jobs = await this.prisma.$queryRaw<{ booking_id: string; code: string; service_id: string; amount: bigint; at: Date; paid: boolean }[]>`
      SELECT l.booking_id, b.code, b.service_id, SUM(l.amount_paise)::bigint AS amount, MAX(l.created_at) AS at,
             bool_and(COALESCE(p.state = 'PAID', false)) AS paid
      FROM earnings_ledger l
      JOIN bookings b ON b.id = l.booking_id
      LEFT JOIN payouts p ON p.id = l.payout_id
      WHERE l.technician_id = ${technicianId}::uuid AND l.type IN ${JOB_CREDITS}
      GROUP BY l.booking_id, b.code, b.service_id
      ORDER BY at DESC, l.booking_id
      LIMIT ${EARNINGS_ENTRIES_LIMIT}`;
    return {
      today: rupees(sums?.today ?? 0n),
      jobsToday: Number(sums?.jobs_today ?? 0n),
      total: rupees(sums?.total ?? 0n),
      pendingPayout: rupees(sums?.balance ?? 0n),
      nextPayoutOn: nextPayoutOn(now),
      entries: jobs.map((j) => ({ jobId: j.booking_id, code: j.code, serviceId: j.service_id, amount: rupees(j.amount), at: j.at.getTime(), payout: j.paid ? 'PAID' : 'PENDING' })),

      weeks: await this.weeks(technicianId, now),
    };
  }

  /** Totals per IST week (Monday to Sunday) for the weeks on screen, and the payouts that settled them. */
  private async weeks(technicianId: string, now: number): Promise<WeekSummary[]> {
    const thisMonday = payoutCutoff(now).cutoffMs;
    const since = new Date(thisMonday - (WEEKS_SHOWN - 1) * 7 * 24 * 60 * 60_000);
    const totals = await this.prisma.$queryRaw<{ week: string; earned: bigint; cash: bigint; jobs: bigint }[]>`
      SELECT to_char(date_trunc('week', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS week,
             COALESCE(SUM(amount_paise) FILTER (WHERE type IN ${JOB_CREDITS}), 0)::bigint AS earned,
             COALESCE(-SUM(amount_paise) FILTER (WHERE type = 'CASH_COLLECTED'), 0)::bigint AS cash,
             COUNT(DISTINCT booking_id) FILTER (WHERE type IN ${JOB_CREDITS}) AS jobs
      FROM earnings_ledger WHERE technician_id = ${technicianId}::uuid AND created_at >= ${since}
      GROUP BY 1`;
    const payouts = await this.prisma.payout.findMany({
      where: { technicianId, periodEnd: { gte: since } },
      select: { periodEnd: true, state: true, amountPaise: true, paidAt: true, providerRef: true },
    });
    return weeklySummary(
      now,
      totals.map((r) => ({ week: r.week, earnedPaise: r.earned, cashPaise: r.cash, jobs: Number(r.jobs) })),
      payouts.map((p) => ({ periodEnd: p.periodEnd.toISOString().slice(0, 10), state: p.state, amountPaise: p.amountPaise, paidAt: p.paidAt?.getTime() ?? null, providerRef: p.providerRef })),
    );
  }

  // ---------- weekly payouts ----------

  /**
   * Creates one payout per technician for everything not yet in a payout up to last Sunday (IST), linking those
   * ledger rows to it. A technician whose balance for the period is zero or negative (more cash collected than
   * earned) gets no payout; the rows carry over to next week. Running it twice creates nothing new.
   */
  async prepare(actor: PayoutActor): Promise<PayoutRow[]> {
    const { cutoffMs, periodEnd } = payoutCutoff(this.clock.now());
    const cutoff = new Date(cutoffMs);
    // The team's demo technicians never get a real payout.
    const due = await this.prisma.earningsLedger.groupBy({
      by: ['technicianId'],
      where: { payoutId: null, createdAt: { lt: cutoff }, technician: { user: { isDemo: false } } },
    });
    const created: string[] = [];
    for (const { technicianId } of due) {
      const id = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: bigint; amount_paise: bigint; created_at: Date }[]>`
          SELECT id, amount_paise, created_at FROM earnings_ledger
          WHERE technician_id = ${technicianId}::uuid AND payout_id IS NULL AND created_at < ${cutoff}
          ORDER BY id FOR UPDATE`;
        const amountPaise = rows.reduce((sum, r) => sum + r.amount_paise, 0n);
        if (rows.length === 0 || amountPaise <= 0n) return null;
        const first = rows.reduce((min, r) => (r.created_at < min ? r.created_at : min), rows[0]!.created_at);
        const payout = await tx.payout.create({
          data: {
            technicianId,
            periodStart: new Date(`${istDate(first.getTime())}T00:00:00Z`),
            periodEnd: new Date(`${periodEnd}T00:00:00Z`),
            amountPaise,
            createdAt: new Date(this.clock.now()),
          },
        });
        await tx.earningsLedger.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { payoutId: payout.id } });
        await this.audit.record(this.auditEntry(actor, 'payout.prepare', payout.id, { technicianId, amountPaise: amountPaise.toString(), entries: rows.length, periodEnd }), tx);
        return payout.id;
      });
      if (id) created.push(id);
    }
    return this.rows({ id: { in: created } });
  }

  /** Payouts in a state (waiting to be paid by default), oldest first. */
  list(state: PayoutState = 'PENDING'): Promise<PayoutRow[]> {
    return this.rows({ state });
  }

  /** The transfer went through: the payout is PAID and the ledger gets the matching debit. */
  async markPaid(payoutId: string, reference: string, actor: PayoutActor): Promise<PayoutRow> {
    const ref = reference.trim();
    if (!ref) throw new AppError('VALIDATION', { fields: { reference: 'REQUIRED' } }, 'a transfer reference is required');
    await this.prisma.$transaction(async (tx) => {
      const p = await this.lockOpen(tx, payoutId);
      const now = new Date(this.clock.now());
      await tx.payout.update({ where: { id: p.id }, data: { state: 'PAID', providerRef: ref, paidAt: now } });
      await tx.earningsLedger.create({ data: { technicianId: p.technicianId, type: 'PAYOUT', amountPaise: -p.amountPaise, payoutId: p.id, createdAt: now } });
      await this.audit.record(this.auditEntry(actor, 'payout.paid', p.id, { state: 'PAID', amountPaise: p.amountPaise.toString() }, { state: p.state }), tx);
    });
    return (await this.rows({ id: payoutId }))[0]!;
  }

  /** The transfer failed: the payout is FAILED and its ledger rows go back into the next run. */
  async markFailed(payoutId: string, actor: PayoutActor): Promise<PayoutRow> {
    await this.prisma.$transaction(async (tx) => {
      const p = await this.lockOpen(tx, payoutId);
      await tx.payout.update({ where: { id: p.id }, data: { state: 'FAILED' } });
      const released = await tx.earningsLedger.updateMany({ where: { payoutId: p.id }, data: { payoutId: null } });
      await this.audit.record(this.auditEntry(actor, 'payout.failed', p.id, { state: 'FAILED', released: released.count }, { state: p.state }), tx);
    });
    return (await this.rows({ id: payoutId }))[0]!;
  }

  private async lockOpen(tx: Prisma.TransactionClient, payoutId: string) {
    if (!UUID.test(payoutId)) throw new AppError('NOT_FOUND');
    await tx.$queryRaw`SELECT id FROM payouts WHERE id = ${payoutId}::uuid FOR UPDATE`;
    const p = await tx.payout.findUnique({ where: { id: payoutId } });
    if (!p) throw new AppError('NOT_FOUND');
    if (p.state !== 'PENDING' && p.state !== 'PROCESSING') throw new AppError('CONFLICT', {}, `payout is ${p.state}`);
    return p;
  }

  private async rows(where: Prisma.PayoutWhereInput): Promise<PayoutRow[]> {
    const payouts = await this.prisma.payout.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { technician: { select: { user: { select: { nameEnc: true } } } } },
    });
    return Promise.all(
      payouts.map(async (p) => ({
        id: p.id,
        technicianId: p.technicianId,
        technicianName: p.technician.user.nameEnc ? await this.cipher.decrypt('users.name', p.technician.user.nameEnc) : '',
        periodStart: p.periodStart.toISOString().slice(0, 10),
        periodEnd: p.periodEnd.toISOString().slice(0, 10),
        amount: rupees(p.amountPaise),
        state: p.state,
        providerRef: p.providerRef,
      })),
    );
  }

  private auditEntry(actor: PayoutActor, action: string, payoutId: string, after: Prisma.InputJsonObject, before?: Prisma.InputJsonObject) {
    return { actorType: actor.type, actorId: actor.id, action, entity: 'payout', entityId: payoutId, after: { ...after, via: actor.via }, ...(before ? { before } : {}) };
  }
}
