// Super admin: customers and technicians. Lists with search, one person's full picture, and the actions: block /
// unblock, sign out everywhere, delete the account (the same erasure as "Delete account" in the app); for technicians
// also approve / reject / suspend / reinstate / take offline, through the same verification service as the command
// line. The Aadhaar check itself stays with the technician's own scan in the app: the portal can see whether it
// passed, never mark it passed. Weekly payouts too. Everything is in the audit log.
import { Injectable } from '@nestjs/common';
import type { Prisma, UserRole, Verification } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { Hashing } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { SessionCheck } from '../auth/session-check';
import { UUID } from '../bookings/booking-core';
import { ACTIVE_STATUSES, TECH_ACTIVE } from '../bookings/booking-status';
import { EarningsService, type PayoutRow } from '../earnings/earnings.service';
import { TechVerificationService } from '../technicians/tech-verification.service';
import { UsersService } from '../users/users.service';
import type { AdminActor } from './admin-bookings.service';

const PAGE = 50;
/** Name search decrypts names, so it looks at the newest accounts only (plenty for the pilot). */
const NAME_SEARCH_SCAN = 2000;

export interface PersonRow {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly status: 'ACTIVE' | 'BLOCKED' | 'DELETED';
  readonly demo: boolean;
  readonly createdAt: number;
  readonly bookings: number;
}

export interface TechRow extends PersonRow {
  readonly verification: Verification | null;
  readonly online: boolean;
  readonly trades: readonly string[];
  readonly rating: number | null;
  readonly ratingCount: number;
  readonly jobsDone: number;
  readonly aadhaarChecked: boolean;
  readonly techCode: string | null;
}

export interface PersonDetail {
  readonly person: PersonRow | TechRow;
  readonly recentBookings: readonly { readonly id: string; readonly code: string; readonly status: string; readonly serviceId: string; readonly createdAt: number }[];
  readonly activeBooking: string | null;
  readonly ratings: readonly { readonly stars: number; readonly comment: string; readonly at: number }[];
  readonly tickets: readonly { readonly id: string; readonly kind: string; readonly state: string; readonly at: number }[];
  readonly area: string | null;
  readonly earnings: { readonly today: number; readonly total: number; readonly pending: number } | null;
}

export type TechAction = 'approve' | 'reject' | 'suspend' | 'reinstate' | 'offline';

@Injectable()
export class AdminPeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly hashing: Hashing,
    private readonly users: UsersService,
    private readonly verification: TechVerificationService,
    private readonly earnings: EarningsService,
    private readonly sessions: SessionCheck,
    private readonly audit: AuditService,
  ) {}

  async list(role: 'CUSTOMER' | 'TECHNICIAN', q: { search?: string; filter?: string; page?: number }): Promise<{ rows: (PersonRow | TechRow)[]; total: number }> {
    const search = (q.search ?? '').trim();
    const digits = search.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    const where: Prisma.UserWhereInput = {
      role,
      status: q.filter === 'BLOCKED' ? 'BLOCKED' : q.filter === 'DELETED' ? 'DELETED' : { not: 'DELETED' },
      ...(role === 'TECHNICIAN' && q.filter && ['PENDING', 'APPROVED', 'NEEDS_CORRECTION', 'REJECTED', 'SUSPENDED'].includes(q.filter) ? { technician: { verification: q.filter as Verification } } : {}),
      ...(role === 'TECHNICIAN' && q.filter === 'ONLINE' ? { technician: { online: true } } : {}),
      ...(/^[6-9]\d{9}$/.test(digits) ? { phoneHash: this.hashing.phone(digits) } : {}),
      ...(UUID.test(search) ? { id: search } : {}),
    };
    const include = { technician: { include: { skills: true } }, _count: { select: { bookings: true } } } as const;
    const page = Math.max(0, q.page ?? 0);
    const byName = search.length >= 2 && !/^[6-9]\d{9}$/.test(digits) && !UUID.test(search);
    if (byName) {
      const rows = await this.prisma.user.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: NAME_SEARCH_SCAN });
      const all = await Promise.all(rows.map((u) => this.row(u, role)));
      const hits = all.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
      return { rows: hits.slice(page * PAGE, page * PAGE + PAGE), total: hits.length };
    }
    const [rows, total] = await Promise.all([this.prisma.user.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: page * PAGE, take: PAGE }), this.prisma.user.count({ where })]);
    return { rows: await Promise.all(rows.map((u) => this.row(u, role))), total };
  }

  async detail(id: string): Promise<PersonDetail> {
    const user = await this.prisma.user.findUnique({ where: { id: this.uuid(id) }, include: { technician: { include: { skills: true } }, _count: { select: { bookings: true } } } });
    if (!user || (user.role !== 'CUSTOMER' && user.role !== 'TECHNICIAN')) throw new AppError('NOT_FOUND');
    const tech = user.role === 'TECHNICIAN';
    const mine: Prisma.BookingWhereInput = tech ? { technicianId: user.id } : { customerId: user.id };
    const [bookings, active, ratings, tickets] = await Promise.all([
      this.prisma.booking.findMany({ where: mine, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, code: true, status: true, serviceId: true, createdAt: true } }),
      this.prisma.booking.findFirst({ where: { ...mine, status: { in: [...(tech ? TECH_ACTIVE : ACTIVE_STATUSES)] } }, select: { id: true } }),
      this.prisma.rating.findMany({ where: tech ? { technicianId: user.id } : { customerId: user.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.supportTicket.findMany({ where: { raisedBy: user.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    let earnings: PersonDetail['earnings'] = null;
    if (tech && user.technician) {
      const s = await this.earnings.summary(user.id).catch(() => null);
      if (s) earnings = { today: s.today, total: s.total, pending: s.pendingPayout };
    }
    return {
      person: await this.row(user, user.role),
      recentBookings: bookings.map((b) => ({ id: b.id, code: b.code, status: b.status, serviceId: b.serviceId, createdAt: b.createdAt.getTime() })),
      activeBooking: active?.id ?? null,
      ratings: ratings.map((r) => ({ stars: r.stars, comment: r.comment, at: r.createdAt.getTime() })),
      tickets: tickets.map((t) => ({ id: t.id, kind: t.kind, state: t.state, at: t.createdAt.getTime() })),
      area: user.technician ? `${user.technician.areas} · ${user.technician.city} ${user.technician.pincode}` : null,
      earnings,
    };
  }

  /** Blocked: signed out everywhere at once and cannot sign in again; a technician goes offline. */
  async block(id: string, blocked: boolean, reason: string, by: AdminActor): Promise<void> {
    const user = await this.person(id);
    if (user.status === 'DELETED') throw new AppError('CONFLICT', {}, 'the account is deleted');
    if ((user.status === 'BLOCKED') === blocked) return;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { status: blocked ? 'BLOCKED' : 'ACTIVE' } });
      if (blocked) {
        await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
        if (user.role === 'TECHNICIAN') await tx.technician.updateMany({ where: { userId: user.id }, data: { online: false, availabilitySource: 'SYSTEM' } });
      }
      await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: blocked ? 'admin.user_block' : 'admin.user_unblock', entity: 'user', entityId: user.id, before: { status: user.status }, after: { status: blocked ? 'BLOCKED' : 'ACTIVE', reason: reason.slice(0, 200) }, ip: by.ip }, tx);
    });
    this.sessions.forget(user.id);
  }

  /** Ends every session (lost phone): they sign in again with an SMS code. */
  async signOutEverywhere(id: string, by: AdminActor): Promise<number> {
    const user = await this.person(id);
    const { count } = await this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    this.sessions.forget(user.id);
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'admin.user_sign_out', entity: 'user', entityId: user.id, after: { sessions: String(count) }, ip: by.ip });
    return count;
  }

  /** The app's "Delete account", for them: personal data erased, bookings anonymised. Not while a job is running. */
  async delete(id: string, by: AdminActor): Promise<void> {
    const user = await this.person(id);
    if (user.status === 'DELETED') return;
    const wasBlocked = user.status === 'BLOCKED';
    // UsersService.delete works on active accounts (it is the account's own button); a blocked one is opened for it.
    if (wasBlocked) await this.prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    try {
      await this.users.delete(user.id);
    } catch (err) {
      if (wasBlocked) await this.prisma.user.update({ where: { id: user.id }, data: { status: 'BLOCKED' } });
      throw err;
    }
    this.sessions.forget(user.id);
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'admin.user_delete', entity: 'user', entityId: user.id, before: { status: user.status }, after: { status: 'DELETED' }, ip: by.ip });
  }

  async techAction(id: string, action: TechAction, reason: string, by: AdminActor): Promise<void> {
    const user = await this.person(id);
    if (user.role !== 'TECHNICIAN') throw new AppError('NOT_FOUND');
    const actor = { type: 'ADMIN' as const, id: by.id, via: `hq:${by.ip}` };
    const why = reason.trim() || 'by Housefi';
    switch (action) {
      case 'approve':
        await this.verification.approve(user.id, actor);
        return;
      case 'reject':
        return this.verification.reject(user.id, why, actor);
      case 'suspend':
        return this.verification.suspend(user.id, why, actor);
      case 'reinstate':
        return this.verification.reinstate(user.id, why, actor);
      case 'offline': {
        await this.prisma.technician.updateMany({ where: { userId: user.id }, data: { online: false, availabilitySource: 'SYSTEM' } });
        await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'admin.tech_offline', entity: 'technician', entityId: user.id, ip: by.ip });
        return;
      }
    }
  }

  // ---------- payouts (every Monday) ----------

  payouts(state: 'PENDING' | 'PAID' | 'FAILED'): Promise<PayoutRow[]> {
    return this.earnings.list(state);
  }

  preparePayouts(by: AdminActor): Promise<PayoutRow[]> {
    return this.earnings.prepare({ type: 'ADMIN', id: by.id, via: `hq:${by.ip}` });
  }

  payoutPaid(id: string, reference: string, by: AdminActor): Promise<PayoutRow> {
    return this.earnings.markPaid(id, reference, { type: 'ADMIN', id: by.id, via: `hq:${by.ip}` });
  }

  payoutFailed(id: string, by: AdminActor): Promise<PayoutRow> {
    return this.earnings.markFailed(id, { type: 'ADMIN', id: by.id, via: `hq:${by.ip}` });
  }

  // ---------- helpers ----------

  private async row(
    u: Prisma.UserGetPayload<{ include: { technician: { include: { skills: true } }; _count: { select: { bookings: true } } } }>,
    role: UserRole,
  ): Promise<PersonRow | TechRow> {
    const base: PersonRow = {
      id: u.id,
      name: u.nameEnc ? await this.cipher.decrypt('users.name', u.nameEnc) : '',
      phone: u.phoneEnc.length ? await this.cipher.decrypt('users.phone', u.phoneEnc) : '',
      status: u.status,
      demo: u.isDemo,
      createdAt: u.createdAt.getTime(),
      bookings: u._count.bookings,
    };
    if (role !== 'TECHNICIAN') return base;
    const t = u.technician;
    return {
      ...base,
      bookings: t ? await this.prisma.booking.count({ where: { technicianId: u.id } }) : 0,
      verification: t?.verification ?? null,
      online: t?.online ?? false,
      trades: t?.skills.map((s) => s.categoryId) ?? [],
      rating: t?.ratingAvg ? Number(t.ratingAvg) : null,
      ratingCount: t?.ratingCount ?? 0,
      jobsDone: t?.jobsDone ?? 0,
      aadhaarChecked: !!t?.aadhaarVerifiedAt,
      techCode: t?.techCode ?? null,
    };
  }

  private async person(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id: this.uuid(id) } });
    if (!user || (user.role !== 'CUSTOMER' && user.role !== 'TECHNICIAN')) throw new AppError('NOT_FOUND');
    return user;
  }

  private uuid(id: string): string {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    return id;
  }
}
