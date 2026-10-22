import { Injectable } from '@nestjs/common';
import type { Category, CategoryId, Service, ServiceIssue } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paiseToRupees } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.module';
import { type Festival, festivalAt } from './festivals';

interface Localized {
  readonly en: string;
  readonly te: string;
}

/** openapi.yaml Category. */
export interface CategoryDto {
  readonly id: CategoryId;
  readonly name: Localized;
  readonly tagline: Localized;
  readonly art: string;
  readonly wash: string;
}

/** openapi.yaml Service. The typical maximum is internal (price check) and not exposed. */
export interface ServiceDto {
  readonly id: string;
  readonly categoryId: CategoryId;
  readonly name: Localized;
  readonly description: Localized;
  readonly visitFee: number;
  readonly repairFrom: number;
  readonly durationMin: readonly [number, number];
  readonly rating: number;
  readonly reviews: number;
  readonly issues: readonly { readonly id: string; readonly name: Localized }[];
  readonly keywords: readonly string[];
  readonly popular: boolean;
}

const withIssues = { issues: { orderBy: { sort: 'asc' } } } as const;

function toCategory(c: Category): CategoryDto {
  return { id: c.id, name: { en: c.nameEn, te: c.nameTe }, tagline: { en: c.taglineEn, te: c.taglineTe }, art: c.art, wash: c.wash };
}

function toService(s: Service & { issues: ServiceIssue[] }): ServiceDto {
  return {
    id: s.id,
    categoryId: s.categoryId,
    name: { en: s.nameEn, te: s.nameTe },
    description: { en: s.descriptionEn, te: s.descriptionTe },
    visitFee: paiseToRupees(s.visitFeePaise),
    repairFrom: paiseToRupees(s.repairFromPaise),
    durationMin: [s.durationMin, s.durationMax],
    rating: s.rating,
    reviews: s.reviews,
    issues: s.issues.map((i) => ({ id: i.id, name: { en: i.nameEn, te: i.nameTe } })),
    keywords: s.keywords,
    popular: s.popular,
  };
}

/** Read-only catalog, in the app's order. Only active services are listed or found. */
/** openapi.yaml FestiveCoupon, in rupees: `value` is rupees off (FLAT) or percent off (PERCENT, capped by maxDiscount). */
export interface FestiveCouponDto {
  readonly code: string;
  readonly kind: 'FLAT' | 'PERCENT';
  readonly value: number;
  readonly maxDiscount: number | null;
  readonly minBill: number;
  readonly firstBookingOnly: boolean;
  readonly validTo: number | null;
}

/** openapi.yaml Greeting: the festival of the day for the home screens, with its live coupon. `until`: its last moment (ms). */
export type GreetingDto = Omit<Festival, 'from' | 'to' | 'coupon'> & { readonly coupon: FestiveCouponDto | null; readonly until: number };

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** The festive greeting for the home screens at `now`, or null on ordinary days (festivals.ts). */
  async greeting(now: number): Promise<GreetingDto | null> {
    const f = festivalAt(now);
    if (!f) return null;
    const { from: _from, to, coupon, ...rest } = f;
    // The end of the last day, India time.
    return { ...rest, coupon: coupon ? await this.liveCoupon(coupon, now) : null, until: Date.parse(`${to}T23:59:59.999+05:30`) };
  }

  /**
   * The festival's coupon as the home screen shows it, only while anyone could use it: it exists, is switched on, is
   * within its dates and is not used up (each customer's own limits are checked when they apply it).
   */
  private async liveCoupon(code: string, now: number): Promise<FestiveCouponDto | null> {
    const c = await this.prisma.coupon.findUnique({ where: { code }, include: { _count: { select: { redemptions: true } } } });
    if (!c || !c.active) return null;
    if ((c.validFrom && c.validFrom.getTime() > now) || (c.validTo && c.validTo.getTime() <= now)) return null;
    if (c.maxUses !== null && c._count.redemptions >= c.maxUses) return null;
    return {
      code: c.code,
      kind: c.kind,
      value: c.value,
      maxDiscount: c.maxDiscountPaise === null ? null : Number(c.maxDiscountPaise / 100n),
      minBill: Number(c.minBillPaise / 100n),
      firstBookingOnly: c.firstBookingOnly,
      validTo: c.validTo?.getTime() ?? null,
    };
  }

  async categories(): Promise<CategoryDto[]> {
    const rows = await this.prisma.category.findMany({ orderBy: { sort: 'asc' } });
    return rows.map(toCategory);
  }

  async services(categoryId?: CategoryId): Promise<ServiceDto[]> {
    const rows = await this.prisma.service.findMany({
      where: { active: true, ...(categoryId ? { categoryId } : {}) },
      orderBy: { sort: 'asc' },
      include: withIssues,
    });
    return rows.map(toService);
  }

  async service(id: string): Promise<ServiceDto> {
    const row = await this.prisma.service.findFirst({ where: { id, active: true }, include: withIssues });
    if (!row) throw new AppError('NOT_FOUND');
    return toService(row);
  }
}
