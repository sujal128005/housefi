// "Top problems near you" (README §3 Home): the 6 problems booked most in the last 7 days around a PIN code, ranked by
// rules until a model learns from real data. Behind an interface so the ranking can be swapped without touching the API.
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';
import { PrismaService } from '../../common/prisma/prisma.module';

export const TOP_PROBLEMS_COUNT = 6;
export const RECENT_DAYS = 7;

/**
 * Used to fill the list while there is little booking data: the app's own TOP_PROBLEMS (docs/app-contract/catalog.ts),
 * then the first issue of each popular service. recentCount 0.
 */
export const FALLBACK_PROBLEMS: readonly { readonly serviceId: string; readonly issueId: string }[] = [
  { serviceId: 'plumb-tap', issueId: 'tap-leak' },
  { serviceId: 'elec-fan', issueId: 'fan-dead' },
  { serviceId: 'ac-service', issueId: 'acs-cool' },
  { serviceId: 'plumb-block', issueId: 'blk-sink' },
  { serviceId: 'elec-switch', issueId: 'sw-dead' },
  { serviceId: 'app-washer', issueId: 'wm-drain' },
];

export interface LocalProblem {
  readonly serviceId: string;
  readonly issueId: string;
  /** Bookings for this problem in the area in the last 7 days (city-wide when the area had too few). */
  readonly recentCount: number;
}

/** openapi.yaml LocalTopProblems. */
export interface LocalTopProblemsDto {
  /** "Banjara Hills, Hyderabad"; null for a city-wide list or a PIN we have not served yet. */
  readonly area: string | null;
  /** Always 6, most booked first. */
  readonly items: readonly LocalProblem[];
}

export interface TopProblemsRanker {
  rank(pincode: string | null): Promise<LocalTopProblemsDto>;
}

export const TOP_PROBLEMS_RANKER = Symbol('TOP_PROBLEMS_RANKER');

type Scope = { readonly pins: readonly string[] } | { readonly city: string } | 'all';

const key = (p: { serviceId: string; issueId: string }) => `${p.serviceId}/${p.issueId}`;

/**
 * Counts bookings (each counted once per issue chip it had) created in the last 7 days: first in the PIN and its
 * neighbouring PINs (service_area_pincodes), then city-wide, then the fallback list, until there are 6. Only
 * bookings that went ahead count (paid; unpaid ones that expired do not), and only issues still in the catalog.
 */
@Injectable()
export class RuleBasedTopProblems implements TopProblemsRanker {
  constructor(
    private readonly prisma: PrismaService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  async rank(pincode: string | null): Promise<LocalTopProblemsDto> {
    const items: LocalProblem[] = [];
    const seen = new Set<string>();
    const add = (rows: readonly LocalProblem[]) => {
      for (const r of rows) {
        if (items.length >= TOP_PROBLEMS_COUNT || seen.has(key(r))) continue;
        seen.add(key(r));
        items.push(r);
      }
    };
    let area: string | null = null;
    let city: string | null = null;
    if (pincode) {
      const near = await this.prisma.serviceAreaPincode.findMany({ where: { pincode }, select: { nearPincode: true } });
      add(await this.counts({ pins: [pincode, ...near.map((n) => n.nearPincode.trim())] }));
      ({ area, city } = await this.areaOf(pincode));
    }
    if (items.length < TOP_PROBLEMS_COUNT) add(await this.counts(city ? { city } : 'all'));
    if (items.length < TOP_PROBLEMS_COUNT) add(await this.fallback());
    return { area, items };
  }

  private async counts(scope: Scope): Promise<LocalProblem[]> {
    const since = new Date(this.clock.now() - RECENT_DAYS * 24 * 60 * 60_000);
    const inScope =
      scope === 'all' ? Prisma.sql`TRUE` : 'pins' in scope ? Prisma.sql`trim(b.pincode) = ANY(${scope.pins}::text[])` : Prisma.sql`lower(b.city) = lower(${scope.city})`;
    const rows = await this.prisma.$queryRaw<{ service_id: string; issue_id: string; n: number }[]>`
      SELECT b.service_id, i.issue_id, COUNT(DISTINCT b.id)::int AS n
      FROM bookings b
      CROSS JOIN LATERAL unnest(b.issue_ids) AS i(issue_id)
      JOIN service_issues si ON si.id = i.issue_id AND si.service_id = b.service_id
      JOIN services s ON s.id = b.service_id AND s.active
      WHERE b.created_at >= ${since}
        AND b.status NOT IN ('AWAITING_PAYMENT', 'PAYMENT_PENDING')
        AND b.cancel_reason IS DISTINCT FROM 'UNPAID_EXPIRED'
        AND ${inScope}
      GROUP BY b.service_id, i.issue_id
      ORDER BY n DESC, b.service_id, i.issue_id
      LIMIT ${TOP_PROBLEMS_COUNT * 2}`;
    return rows.map((r) => ({ serviceId: r.service_id, issueId: r.issue_id, recentCount: r.n }));
  }

  /** The locality most bookings in this PIN were in, and its city, from past bookings (plain columns). */
  private async areaOf(pincode: string): Promise<{ area: string | null; city: string | null }> {
    const [top] = await this.prisma.$queryRaw<{ locality: string; city: string }[]>`
      SELECT locality, city FROM bookings WHERE trim(pincode) = ${pincode} AND locality <> ''
      GROUP BY locality, city ORDER BY COUNT(*) DESC, locality LIMIT 1`;
    if (!top) {
      const [any] = await this.prisma.$queryRaw<{ city: string }[]>`SELECT city FROM bookings WHERE trim(pincode) = ${pincode} LIMIT 1`;
      return { area: null, city: any?.city ?? null };
    }
    return { area: `${top.locality}, ${top.city}`, city: top.city };
  }

  /** The fallback list, keeping only what is still in the catalog, then popular services' first issues. */
  private async fallback(): Promise<LocalProblem[]> {
    const issues = await this.prisma.serviceIssue.findMany({
      where: { service: { active: true } },
      orderBy: [{ serviceId: 'asc' }, { sort: 'asc' }],
      select: { id: true, serviceId: true, service: { select: { popular: true } } },
    });
    const exists = new Set(issues.map((i) => key({ serviceId: i.serviceId, issueId: i.id })));
    const listed = FALLBACK_PROBLEMS.filter((p) => exists.has(key(p)));
    const firstOfPopular = [...new Map(issues.filter((i) => i.service.popular).map((i) => [i.serviceId, i] as const)).values()].map((i) => ({ serviceId: i.serviceId, issueId: i.id }));
    const firstOfAny = [...new Map(issues.map((i) => [i.serviceId, i] as const)).values()].map((i) => ({ serviceId: i.serviceId, issueId: i.id }));
    return [...listed, ...firstOfPopular, ...firstOfAny].map((p) => ({ ...p, recentCount: 0 }));
  }
}
