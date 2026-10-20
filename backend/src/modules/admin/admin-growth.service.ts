// Super admin: the catalogue (services, prices, problems customers pick), the parts price list, coupons and
// announcements. A service changed or added here is marked, so the catalogue seed never overwrites it. Every change is
// audited with the admin and their IP.
import { Injectable } from '@nestjs/common';
import { type CategoryId, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { paiseToRupees } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.module';
import { COUPON_CODE, normaliseCode } from '../coupons/coupon-rules';
import { Notifier } from '../notifications/notifier';
import type { AdminActor } from './admin-bookings.service';

const CATEGORIES: readonly CategoryId[] = ['PLUMBING', 'ELECTRICAL', 'AC', 'APPLIANCE', 'CLEANING', 'CARPENTRY'];
/** Notifications per transaction when announcing. */
const BATCH = 500;

const L = (en: string, te: string) => ({ en, te });

export interface AdminServiceDto {
  readonly id: string;
  readonly categoryId: CategoryId;
  readonly name: { en: string; te: string };
  readonly description: { en: string; te: string };
  readonly visitFee: number;
  readonly repairFrom: number;
  readonly repairTypicalMax: number;
  readonly durationMin: number;
  readonly durationMax: number;
  readonly popular: boolean;
  readonly active: boolean;
  readonly sort: number;
  readonly keywords: readonly string[];
  readonly issues: readonly { id: string; name: { en: string; te: string } }[];
  readonly bookings: number;
  readonly editedInHq: boolean;
}

export interface ServiceInput {
  readonly categoryId: CategoryId;
  readonly name: { en: string; te: string };
  readonly description: { en: string; te: string };
  readonly visitFee: number;
  readonly repairFrom: number;
  readonly repairTypicalMax: number;
  readonly durationMin: number;
  readonly durationMax: number;
  readonly popular: boolean;
  readonly active: boolean;
  readonly keywords: readonly string[];
  readonly issues: readonly { id?: string | undefined; name: { en: string; te: string } }[];
}

export interface PartInput {
  readonly categoryId: CategoryId;
  readonly serviceId: string | null;
  readonly name: { en: string; te: string };
  readonly unit: string;
  readonly price: number;
  readonly active: boolean;
  readonly sort: number;
}

export interface CouponInput {
  readonly code: string;
  readonly description: string;
  readonly kind: 'FLAT' | 'PERCENT';
  readonly value: number;
  readonly maxDiscount: number | null;
  readonly minBill: number;
  readonly validFrom: number | null;
  readonly validTo: number | null;
  readonly maxUses: number | null;
  readonly perCustomer: number;
  readonly firstBookingOnly: boolean;
  readonly active: boolean;
}

export interface CouponDto extends Omit<CouponInput, 'validFrom' | 'validTo'> {
  readonly id: string;
  readonly validFrom: number | null;
  readonly validTo: number | null;
  readonly uses: number;
  readonly discountGiven: number;
  readonly createdAt: number;
}

export interface AnnouncementInput {
  readonly audience: 'CUSTOMERS' | 'TECHNICIANS' | 'ALL' | 'DEMO';
  readonly title: { en: string; te: string };
  readonly body: { en: string; te: string };
}

/** "Kitchen sink repair" → "kitchen-sink-repair" (for new service and issue ids). */
export function slug(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'item';
}

@Injectable()
export class AdminGrowthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: Notifier,
    private readonly audit: AuditService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  // ---------- catalogue ----------

  async services(): Promise<AdminServiceDto[]> {
    const rows = await this.prisma.service.findMany({ orderBy: [{ categoryId: 'asc' }, { sort: 'asc' }], include: { issues: { orderBy: { sort: 'asc' } }, _count: { select: { bookings: true } } } });
    return rows.map((s) => ({
      id: s.id,
      categoryId: s.categoryId,
      name: L(s.nameEn, s.nameTe),
      description: L(s.descriptionEn, s.descriptionTe),
      visitFee: paiseToRupees(s.visitFeePaise),
      repairFrom: paiseToRupees(s.repairFromPaise),
      repairTypicalMax: paiseToRupees(s.repairTypicalMaxPaise),
      durationMin: s.durationMin,
      durationMax: s.durationMax,
      popular: s.popular,
      active: s.active,
      sort: s.sort,
      keywords: s.keywords,
      issues: s.issues.map((i) => ({ id: i.id, name: L(i.nameEn, i.nameTe) })),
      bookings: s._count.bookings,
      editedInHq: !!s.editedInHqAt,
    }));
  }

  /** Adds a service (id from its English name) or changes one (`id`). Issues: kept by id, renamed, added or removed. */
  async saveService(id: string | null, input: ServiceInput, by: AdminActor): Promise<AdminServiceDto> {
    this.checkService(input);
    const now = new Date(this.clock.now());
    const serviceId = id ?? (await this.freeServiceId(input.categoryId, input.name.en));
    const fields = {
      categoryId: input.categoryId,
      nameEn: input.name.en.trim(),
      nameTe: input.name.te.trim() || input.name.en.trim(),
      descriptionEn: input.description.en.trim(),
      descriptionTe: input.description.te.trim() || input.description.en.trim(),
      visitFeePaise: BigInt(input.visitFee) * 100n,
      repairFromPaise: BigInt(input.repairFrom) * 100n,
      repairTypicalMaxPaise: BigInt(input.repairTypicalMax) * 100n,
      durationMin: input.durationMin,
      durationMax: input.durationMax,
      popular: input.popular,
      active: input.active,
      keywords: [...new Set(input.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(0, 30),
      editedInHqAt: now,
    };
    const before = id ? await this.prisma.service.findUnique({ where: { id } }) : null;
    if (id && !before) throw new AppError('NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      if (before) await tx.service.update({ where: { id: serviceId }, data: fields });
      else {
        const last = await tx.service.aggregate({ where: { categoryId: input.categoryId }, _max: { sort: true } });
        await tx.service.create({ data: { id: serviceId, ...fields, rating: 0, reviews: 0, sort: (last._max.sort ?? 0) + 1 } });
      }
      const keep: string[] = [];
      for (const [sort, issue] of input.issues.entries()) {
        const names = { nameEn: issue.name.en.trim(), nameTe: issue.name.te.trim() || issue.name.en.trim(), sort };
        const existing = issue.id ? await tx.serviceIssue.findFirst({ where: { id: issue.id, serviceId } }) : null;
        if (existing) {
          await tx.serviceIssue.update({ where: { id: existing.id }, data: names });
          keep.push(existing.id);
        } else {
          let iid = `${serviceId}-${slug(issue.name.en)}`.slice(0, 40);
          for (let n = 2; (await tx.serviceIssue.count({ where: { id: iid } })) > 0; n++) iid = `${iid.slice(0, 36)}-${n}`;
          await tx.serviceIssue.create({ data: { id: iid, serviceId, ...names } });
          keep.push(iid);
        }
      }
      await tx.serviceIssue.deleteMany({ where: { serviceId, id: { notIn: keep } } });
      await this.audit.record({
        actorType: 'ADMIN', actorId: by.id, action: before ? 'catalog.service_update' : 'catalog.service_create', entity: 'service', entityId: serviceId,
        before: before ? { visitFeePaise: before.visitFeePaise.toString(), repairFromPaise: before.repairFromPaise.toString(), active: before.active } : undefined,
        after: { visitFeePaise: fields.visitFeePaise.toString(), repairFromPaise: fields.repairFromPaise.toString(), active: fields.active, issues: String(input.issues.length) },
        ip: by.ip,
      }, tx);
    });
    return (await this.services()).find((s) => s.id === serviceId)!;
  }

  private checkService(s: ServiceInput): void {
    const bad = (field: string) => new AppError('VALIDATION', { fields: { [field]: 'INVALID' } });
    if (!CATEGORIES.includes(s.categoryId)) throw bad('categoryId');
    if (s.name.en.trim().length < 3) throw bad('name.en');
    if (s.visitFee < 0 || s.visitFee > 5000) throw bad('visitFee');
    if (s.repairFrom < 1 || s.repairTypicalMax < s.repairFrom) throw bad('repairTypicalMax');
    if (s.durationMin < 5 || s.durationMax < s.durationMin) throw bad('durationMax');
    if (s.issues.length === 0 || s.issues.some((i) => i.name.en.trim().length < 2)) throw bad('issues');
  }

  private async freeServiceId(categoryId: CategoryId, name: string): Promise<string> {
    const prefix = { PLUMBING: 'plumb', ELECTRICAL: 'elec', AC: 'ac', APPLIANCE: 'appl', CLEANING: 'clean', CARPENTRY: 'carp' }[categoryId];
    const base = `${prefix}-${slug(name)}`.slice(0, 36);
    let id = base;
    for (let n = 2; await this.prisma.service.count({ where: { id } }); n++) id = `${base}-${n}`;
    return id;
  }

  // ---------- parts ----------

  async parts(): Promise<{ id: string; categoryId: CategoryId; serviceId: string | null; name: { en: string; te: string }; unit: string; price: number; active: boolean; sort: number; used: number }[]> {
    const rows = await this.prisma.part.findMany({ orderBy: [{ categoryId: 'asc' }, { sort: 'asc' }, { nameEn: 'asc' }], include: { _count: { select: { lines: true } } } });
    return rows.map((p) => ({ id: p.id, categoryId: p.categoryId, serviceId: p.serviceId, name: L(p.nameEn, p.nameTe), unit: p.unit, price: paiseToRupees(p.pricePaise), active: p.active, sort: p.sort, used: p._count.lines }));
  }

  async savePart(id: string | null, input: PartInput, by: AdminActor): Promise<void> {
    if (!CATEGORIES.includes(input.categoryId) || input.name.en.trim().length < 2 || input.price < 1 || input.price > 200_000 || !/^[a-z ]{2,12}$/.test(input.unit)) {
      throw new AppError('VALIDATION', { fields: { part: 'INVALID' } });
    }
    if (input.serviceId && !(await this.prisma.service.count({ where: { id: input.serviceId, categoryId: input.categoryId } }))) throw new AppError('VALIDATION', { fields: { serviceId: 'INVALID' } });
    const data = {
      categoryId: input.categoryId,
      serviceId: input.serviceId,
      nameEn: input.name.en.trim(),
      nameTe: input.name.te.trim() || input.name.en.trim(),
      unit: input.unit,
      pricePaise: BigInt(input.price) * 100n,
      active: input.active,
      sort: input.sort,
      updatedAt: new Date(this.clock.now()),
    };
    if (id) {
      const before = await this.prisma.part.findUnique({ where: { id } });
      if (!before) throw new AppError('NOT_FOUND');
      await this.prisma.part.update({ where: { id }, data });
      await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'parts.update', entity: 'part', entityId: id, before: { pricePaise: before.pricePaise.toString(), active: before.active }, after: { pricePaise: data.pricePaise.toString(), active: data.active }, ip: by.ip });
    } else {
      const partId = (await this.prisma.part.create({ data })).id;
      await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'parts.create', entity: 'part', entityId: partId, after: { pricePaise: data.pricePaise.toString() }, ip: by.ip });
    }
  }

  // ---------- coupons ----------

  async coupons(): Promise<CouponDto[]> {
    const rows = await this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    const stats = await this.prisma.couponRedemption.groupBy({ by: ['couponId'], _count: { _all: true }, _sum: { discountPaise: true } });
    const by = new Map(stats.map((s) => [s.couponId, s]));
    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      description: c.description,
      kind: c.kind,
      value: c.value,
      maxDiscount: c.maxDiscountPaise === null ? null : paiseToRupees(c.maxDiscountPaise),
      minBill: paiseToRupees(c.minBillPaise),
      validFrom: c.validFrom?.getTime() ?? null,
      validTo: c.validTo?.getTime() ?? null,
      maxUses: c.maxUses,
      perCustomer: c.perCustomer,
      firstBookingOnly: c.firstBookingOnly,
      active: c.active,
      uses: by.get(c.id)?._count._all ?? 0,
      discountGiven: paiseToRupees(by.get(c.id)?._sum.discountPaise ?? 0n),
      createdAt: c.createdAt.getTime(),
    }));
  }

  async saveCoupon(id: string | null, input: CouponInput, by: AdminActor): Promise<void> {
    const code = normaliseCode(input.code);
    const bad = (f: string) => new AppError('VALIDATION', { fields: { [f]: 'INVALID' } });
    if (!COUPON_CODE.test(code)) throw bad('code');
    if (!Number.isInteger(input.value) || input.value < 1 || (input.kind === 'PERCENT' && input.value > 100) || (input.kind === 'FLAT' && input.value > 10_000)) throw bad('value');
    if (input.validFrom && input.validTo && input.validTo <= input.validFrom) throw bad('validTo');
    if (input.perCustomer < 1 || input.perCustomer > 50 || (input.maxUses !== null && input.maxUses < 1)) throw bad('limits');
    const data = {
      code,
      description: input.description.trim().slice(0, 200),
      kind: input.kind,
      value: input.value,
      maxDiscountPaise: input.maxDiscount === null ? null : BigInt(input.maxDiscount) * 100n,
      minBillPaise: BigInt(Math.max(0, input.minBill)) * 100n,
      validFrom: input.validFrom ? new Date(input.validFrom) : null,
      validTo: input.validTo ? new Date(input.validTo) : null,
      maxUses: input.maxUses,
      perCustomer: input.perCustomer,
      firstBookingOnly: input.firstBookingOnly,
      active: input.active,
    };
    try {
      if (id) {
        const before = await this.prisma.coupon.findUnique({ where: { id } });
        if (!before) throw new AppError('NOT_FOUND');
        await this.prisma.coupon.update({ where: { id }, data });
        await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'coupon.update', entity: 'coupon', entityId: id, before: { active: before.active, value: before.value }, after: { active: data.active, value: data.value, code }, ip: by.ip });
      } else {
        const row = await this.prisma.coupon.create({ data: { ...data, createdBy: by.id, createdAt: new Date(this.clock.now()) } });
        await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'coupon.create', entity: 'coupon', entityId: row.id, after: { code, kind: data.kind, value: data.value }, ip: by.ip });
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('CONFLICT', {}, `a coupon ${code} already exists`);
      throw e;
    }
  }

  // ---------- announcements ----------

  async announcements(): Promise<{ id: string; audience: string; title: string; body: string; recipients: number; by: string; at: number }[]> {
    const rows = await this.prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    const admins = new Map((await this.prisma.adminUser.findMany({ select: { id: true, displayName: true } })).map((a) => [a.id, a.displayName]));
    return rows.map((a) => ({ id: a.id, audience: a.audience, title: a.titleEn, body: a.bodyEn, recipients: a.recipients, by: admins.get(a.createdBy) ?? '', at: a.createdAt.getTime() }));
  }

  /** Sends a notification (inbox + push) to everyone in the audience. DEMO: only the team's demo accounts (to test). */
  async announce(input: AnnouncementInput, by: AdminActor): Promise<{ recipients: number }> {
    const t = { en: input.title.en.trim(), te: input.title.te.trim() || input.title.en.trim() };
    const b = { en: input.body.en.trim(), te: input.body.te.trim() || input.body.en.trim() };
    if (t.en.length < 3 || t.en.length > 60 || b.en.length < 3 || b.en.length > 300 || t.te.length > 80 || b.te.length > 400) throw new AppError('VALIDATION', { fields: { announcement: 'INVALID' } });
    const where: Prisma.UserWhereInput = {
      status: 'ACTIVE',
      ...(input.audience === 'CUSTOMERS' ? { role: 'CUSTOMER' } : input.audience === 'TECHNICIANS' ? { role: 'TECHNICIAN' } : input.audience === 'DEMO' ? { isDemo: true, role: { in: ['CUSTOMER', 'TECHNICIAN'] } } : { role: { in: ['CUSTOMER', 'TECHNICIAN'] } }),
    };
    const ids = (await this.prisma.user.findMany({ where, select: { id: true } })).map((u) => u.id);
    const params = { title: t.en, body: b.en, titleTe: t.te, bodyTe: b.te };
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      await this.prisma.$transaction((tx) => this.notifier.enqueue(tx, chunk.map((userId) => ({ userId, kind: 'ANNOUNCEMENT' as const, bookingId: null, params }))));
    }
    const row = await this.prisma.announcement.create({
      data: { audience: input.audience, titleEn: t.en, bodyEn: b.en, titleTe: t.te, bodyTe: b.te, recipients: ids.length, createdBy: by.id, createdAt: new Date(this.clock.now()) },
    });
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'announcement.send', entity: 'announcement', entityId: row.id, after: { audience: input.audience, recipients: String(ids.length) }, ip: by.ip });
    return { recipients: ids.length };
  }
}
