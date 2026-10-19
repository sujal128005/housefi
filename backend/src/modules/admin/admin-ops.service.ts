// Super admin: what needs attention and what happened. Emergency SOS (who pressed it, where they are), reports from
// technicians and customers, queries (call-back requests and live conversations), booking chats (read, delete), the
// analytics, the audit log, and the arcade's scores. Changes go through the support, chat and audit services.
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { paiseToRupees } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.module';
import { MediaUrls } from '../../common/storage/object-store';
import { UUID } from '../bookings/booking-core';
import { ChatService } from '../chat/chat.service';
import { SupportChatService } from '../support/support-chat.service';
import { SupportService } from '../support/support.service';
import type { AdminActor } from './admin-bookings.service';

const MIN = 60_000;
/** A technician's last position counts as "now" for this long. */
const LIVE_MS = 10 * MIN;

export type TicketGroup = 'SOS' | 'REPORTS' | 'QUERIES';
const GROUP_WHERE: Readonly<Record<TicketGroup, Prisma.SupportTicketWhereInput>> = {
  SOS: { kind: 'UNSAFE' },
  QUERIES: { kind: 'CALLBACK' },
  REPORTS: { kind: { notIn: ['UNSAFE', 'CALLBACK'] } },
};

export interface Spot {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number | null;
  readonly at: number | null;
  /** PHONE: the phone's position when the button was pressed; LIVE: the technician's latest position; ADDRESS: the booking's address. */
  readonly source: 'PHONE' | 'LIVE' | 'ADDRESS';
}

export interface TicketDto {
  readonly id: string;
  readonly kind: string;
  readonly priority: string;
  readonly state: string;
  readonly note: string;
  readonly createdAt: number;
  readonly person: { readonly id: string; readonly role: string; readonly name: string; readonly phone: string };
  readonly booking: { readonly id: string; readonly code: string; readonly status: string; readonly area: string; readonly otherName: string | null; readonly otherPhone: string | null } | null;
  /** Best first: where they pressed it, the technician's live position, the address. */
  readonly spots: readonly Spot[];
  readonly handledBy: string | null;
  readonly handledAt: number | null;
  readonly resolvedAt: number | null;
  readonly resolution: string | null;
}

export interface AnalyticsDto {
  readonly days: number;
  readonly daily: readonly { date: string; created: number; completed: number; cancelled: number; revenue: number; newCustomers: number }[];
  readonly byCategory: readonly { categoryId: string; bookings: number; completed: number; revenue: number }[];
  readonly funnel: { readonly created: number; readonly paid: number; readonly assigned: number; readonly completed: number };
  readonly cancelReasons: readonly { reason: string; count: number }[];
  readonly heatmap: readonly { dow: number; hour: number; count: number }[];
  readonly topAreas: readonly { area: string; bookings: number }[];
  readonly topTechnicians: readonly { id: string; name: string; jobs: number; rating: number | null }[];
  readonly ratings: readonly { stars: number; count: number }[];
  readonly paymentMethods: readonly { method: string; count: number; amount: number }[];
  readonly timing: { readonly avgMinToAssign: number | null; readonly avgMinToComplete: number | null };
  readonly totals: { readonly bookings: number; readonly completed: number; readonly revenue: number; readonly avgTicket: number; readonly completionRate: number; readonly cancelRate: number };
}

@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly media: MediaUrls,
    private readonly support: SupportService,
    private readonly supportChat: SupportChatService,
    private readonly chat: ChatService,
    private readonly audit: AuditService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  // ---------- tickets: SOS, reports, call-back requests ----------

  /** Open ones first (most urgent, oldest), then those resolved in the last `days`. */
  async tickets(group: TicketGroup, state: 'OPEN' | 'RESOLVED'): Promise<TicketDto[]> {
    const since = new Date(this.clock.now() - 30 * 86_400_000);
    const rows = await this.prisma.supportTicket.findMany({
      where: { ...GROUP_WHERE[group], ...(state === 'OPEN' ? { state: { not: 'RESOLVED' } } : { state: 'RESOLVED', resolvedAt: { gt: since } }) },
      orderBy: state === 'OPEN' ? [{ createdAt: 'asc' }] : [{ resolvedAt: 'desc' }],
      take: 200,
      include: {
        raiser: { select: { id: true, role: true, nameEnc: true, phoneEnc: true } },
        booking: { select: { id: true, code: true, status: true, locality: true, city: true, pincode: true, customerId: true, technicianId: true } },
      },
    });
    const rank: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2 };
    if (state === 'OPEN') rows.sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3));
    return Promise.all(rows.map((t) => this.ticketDto(t)));
  }

  async ticket(id: string): Promise<TicketDto> {
    const t = await this.prisma.supportTicket.findUnique({
      where: { id: this.uuid(id) },
      include: {
        raiser: { select: { id: true, role: true, nameEnc: true, phoneEnc: true } },
        booking: { select: { id: true, code: true, status: true, locality: true, city: true, pincode: true, customerId: true, technicianId: true } },
      },
    });
    if (!t) throw new AppError('NOT_FOUND');
    return this.ticketDto(t);
  }

  /** "I'm on it": the other admin sees who took it. */
  async takeTicket(id: string, by: AdminActor): Promise<void> {
    const t = await this.prisma.supportTicket.findUnique({ where: { id: this.uuid(id) } });
    if (!t) throw new AppError('NOT_FOUND');
    if (t.state === 'RESOLVED') throw new AppError('CONFLICT', {}, 'already resolved');
    const now = new Date(this.clock.now());
    await this.prisma.supportTicket.update({ where: { id: t.id }, data: { state: 'IN_PROGRESS', handledBy: by.id, handledAt: now } });
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'support.take', entity: 'support_ticket', entityId: t.id, before: { state: t.state }, after: { state: 'IN_PROGRESS' }, ip: by.ip });
  }

  resolveTicket(id: string, note: string, by: AdminActor): Promise<void> {
    return this.support.resolve(id, note, { type: 'ADMIN', id: by.id, via: `hq:${by.ip}` });
  }

  /** A technician locked out of the start code: unlocked (after HQ called both sides). */
  unlockStart(bookingCode: string, by: AdminActor): Promise<{ code: string; ticketsResolved: number }> {
    return this.support.unlockStartCode(bookingCode, { type: 'ADMIN', id: by.id, via: `hq:${by.ip}` });
  }

  /** The red counter in the sidebar and the alarm: open SOS, newest first seen. */
  async alerts(): Promise<{ sos: number; newestSosAt: number | null; reports: number; queries: number; conversations: number }> {
    const [sos, newest, reports, queries, conversations] = await Promise.all([
      this.prisma.supportTicket.count({ where: { kind: 'UNSAFE', state: { not: 'RESOLVED' } } }),
      this.prisma.supportTicket.findFirst({ where: { kind: 'UNSAFE', state: { not: 'RESOLVED' } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.prisma.supportTicket.count({ where: { ...GROUP_WHERE.REPORTS, state: { not: 'RESOLVED' } } }),
      this.prisma.supportTicket.count({ where: { kind: 'CALLBACK', state: { not: 'RESOLVED' } } }),
      this.prisma.supportThread.count({ where: { state: 'OPEN', unreadForHq: { gt: 0 } } }),
    ]);
    return { sos, newestSosAt: newest?.createdAt.getTime() ?? null, reports, queries, conversations };
  }

  // ---------- live conversations (Queries) ----------

  conversations(state: 'OPEN' | 'CLOSED') {
    return this.supportChat.list(state);
  }

  conversation(id: string) {
    return this.supportChat.forHq(id);
  }

  async reply(id: string, text: string, by: AdminActor): Promise<void> {
    await this.supportChat.reply(id, text, by.id);
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'support.reply', entity: 'support_thread', entityId: id, ip: by.ip });
  }

  async closeConversation(id: string, by: AdminActor): Promise<void> {
    await this.supportChat.close(id, by.id);
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'support.close', entity: 'support_thread', entityId: id, ip: by.ip });
  }

  async deleteConversation(id: string, by: AdminActor): Promise<void> {
    await this.supportChat.remove(id);
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'support.delete_conversation', entity: 'support_thread', entityId: id, ip: by.ip });
  }

  async cleanupConversations(days: number, by: AdminActor): Promise<number> {
    const n = await this.supportChat.removeClosedOlderThan(days);
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'support.cleanup', entity: 'support_thread', entityId: '-', after: { days: String(days), deleted: String(n) }, ip: by.ip });
    return n;
  }

  // ---------- booking chats ----------

  async bookingChats(): Promise<{ bookingId: string; code: string; status: string; messages: number; lastAt: number; customer: string; technician: string }[]> {
    const rows = await this.prisma.$queryRaw<{ booking_id: string; n: bigint; last_at: Date }[]>`
      SELECT booking_id::text, count(*) AS n, max(created_at) AS last_at FROM chat_messages GROUP BY booking_id ORDER BY max(created_at) DESC LIMIT 200`;
    if (!rows.length) return [];
    const bookings = await this.prisma.booking.findMany({
      where: { id: { in: rows.map((r) => r.booking_id) } },
      select: { id: true, code: true, status: true, customer: { select: { nameEnc: true } }, technician: { select: { user: { select: { nameEnc: true } } } } },
    });
    const byId = new Map(bookings.map((b) => [b.id, b]));
    const out = [];
    for (const r of rows) {
      const b = byId.get(r.booking_id);
      if (!b) continue;
      out.push({
        bookingId: b.id,
        code: b.code,
        status: b.status,
        messages: Number(r.n),
        lastAt: r.last_at.getTime(),
        customer: await this.name(b.customer.nameEnc),
        technician: await this.name(b.technician?.user.nameEnc ?? null),
      });
    }
    return out;
  }

  /** A booking chat as both sides wrote it (reading is audited). */
  async bookingChat(bookingId: string, by: AdminActor): Promise<{ code: string; messages: { id: string; from: 'CUSTOMER' | 'TECHNICIAN'; text: string; photo: string | null; at: number }[] }> {
    const b = await this.prisma.booking.findUnique({ where: { id: this.uuid(bookingId) }, select: { id: true, code: true } });
    if (!b) throw new AppError('NOT_FOUND');
    const rows = await this.prisma.chatMessage.findMany({ where: { bookingId: b.id }, orderBy: { seq: 'asc' }, take: 1000 });
    const messages = [];
    for (const m of rows) {
      messages.push({
        id: m.id,
        from: m.senderRole === 'TECHNICIAN' ? ('TECHNICIAN' as const) : ('CUSTOMER' as const),
        text: m.bodyEnc.length ? await this.cipher.decrypt('chat_messages.body', m.bodyEnc) : '',
        photo: m.uploadId ? await this.media.photoUrl(m.uploadId) : null,
        at: m.createdAt.getTime(),
      });
    }
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'chat.read', entity: 'booking', entityId: b.id, ip: by.ip });
    return { code: b.code, messages };
  }

  async deleteBookingChat(bookingId: string, by: AdminActor): Promise<void> {
    const b = await this.prisma.booking.findUnique({ where: { id: this.uuid(bookingId) }, select: { id: true } });
    if (!b) throw new AppError('NOT_FOUND');
    await this.chat.wipe(b.id);
    await this.audit.record({ actorType: 'ADMIN', actorId: by.id, action: 'chat.delete', entity: 'booking', entityId: b.id, ip: by.ip });
  }

  // ---------- analytics ----------

  async analytics(days: number, includeDemo: boolean): Promise<AnalyticsDto> {
    const d = Math.min(365, Math.max(7, Math.round(days)));
    const now = this.clock.now();
    const from = new Date(now - (d - 1) * 86_400_000);
    const demo = includeDemo ? Prisma.sql`` : Prisma.sql`AND NOT b.is_demo`;
    const istDay = (col: Prisma.Sql) => Prisma.sql`(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
    const start = Prisma.sql`${istDay(Prisma.sql`${from}::timestamptz`)}`;

    const [daily, byCategory, funnel, cancels, heat, areas, techs, ratings, methods, timing] = await Promise.all([
      this.prisma.$queryRaw<{ day: Date; created: bigint; completed: bigint; cancelled: bigint; revenue: bigint; new_customers: bigint }[]>`
        SELECT s.day::date AS day,
          (SELECT count(*) FROM bookings b WHERE ${istDay(Prisma.sql`b.created_at`)} = s.day ${demo}) AS created,
          (SELECT count(*) FROM bookings b JOIN booking_events e ON e.booking_id = b.id AND e.status = 'COMPLETED' WHERE ${istDay(Prisma.sql`e.at`)} = s.day ${demo}) AS completed,
          (SELECT count(*) FROM bookings b JOIN booking_events e ON e.booking_id = b.id AND e.status = 'CANCELLED' WHERE ${istDay(Prisma.sql`e.at`)} = s.day ${demo}) AS cancelled,
          (SELECT COALESCE(sum(p.amount_paise), 0) FROM payments p JOIN bookings b ON b.id = p.booking_id
             WHERE p.state = 'PAID' AND p.provider IS DISTINCT FROM 'WAIVED' AND ${istDay(Prisma.sql`p.settled_at`)} = s.day ${demo})::bigint AS revenue,
          (SELECT count(*) FROM users u WHERE u.role = 'CUSTOMER' AND ${istDay(Prisma.sql`u.created_at`)} = s.day ${includeDemo ? Prisma.sql`` : Prisma.sql`AND NOT u.is_demo`}) AS new_customers
        FROM generate_series(${start}, ${istDay(Prisma.sql`${new Date(now)}::timestamptz`)}, interval '1 day') AS s(day)
        ORDER BY s.day`,
      this.prisma.$queryRaw<{ category_id: string; bookings: bigint; completed: bigint; revenue: bigint }[]>`
        SELECT b.category_id::text, count(*) AS bookings, count(*) FILTER (WHERE b.status = 'COMPLETED') AS completed,
          COALESCE((SELECT sum(p.amount_paise) FROM payments p JOIN bookings b2 ON b2.id = p.booking_id
             WHERE b2.category_id = b.category_id AND p.state = 'PAID' AND p.provider IS DISTINCT FROM 'WAIVED' AND p.settled_at >= ${from} ${includeDemo ? Prisma.sql`` : Prisma.sql`AND NOT b2.is_demo`}), 0)::bigint AS revenue
        FROM bookings b WHERE b.created_at >= ${from} ${demo} GROUP BY b.category_id ORDER BY count(*) DESC`,
      this.prisma.$queryRaw<{ created: bigint; paid: bigint; assigned: bigint; completed: bigint }[]>`
        SELECT count(*) AS created,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id AND e.status = 'MATCHING')) AS paid,
          count(*) FILTER (WHERE b.assigned_at IS NOT NULL OR EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id AND e.status = 'ASSIGNED')) AS assigned,
          count(*) FILTER (WHERE b.status = 'COMPLETED') AS completed
        FROM bookings b WHERE b.created_at >= ${from} ${demo}`,
      this.prisma.$queryRaw<{ reason: string | null; count: bigint }[]>`
        SELECT b.cancel_reason::text AS reason, count(*) FROM bookings b WHERE b.status = 'CANCELLED' AND b.created_at >= ${from} ${demo} GROUP BY b.cancel_reason ORDER BY count(*) DESC`,
      this.prisma.$queryRaw<{ dow: number; hour: number; count: bigint }[]>`
        SELECT extract(isodow FROM b.created_at AT TIME ZONE 'Asia/Kolkata')::int AS dow, extract(hour FROM b.created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, count(*)
        FROM bookings b WHERE b.created_at >= ${from} ${demo} GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ area: string; bookings: bigint }[]>`
        SELECT COALESCE(NULLIF(b.locality, ''), b.pincode) || ' · ' || b.pincode AS area, count(*) AS bookings
        FROM bookings b WHERE b.created_at >= ${from} ${demo} GROUP BY 1 ORDER BY count(*) DESC LIMIT 8`,
      this.prisma.$queryRaw<{ id: string; jobs: bigint; rating: string | null }[]>`
        SELECT t.user_id::text AS id, count(*) AS jobs, max(t.rating_avg)::text AS rating
        FROM bookings b JOIN technicians t ON t.user_id = b.technician_id
        WHERE b.status = 'COMPLETED' AND b.created_at >= ${from} ${demo} GROUP BY t.user_id ORDER BY count(*) DESC LIMIT 8`,
      this.prisma.$queryRaw<{ stars: number; count: bigint }[]>`
        SELECT r.stars::int AS stars, count(*) FROM ratings r JOIN bookings b ON b.id = r.booking_id WHERE r.created_at >= ${from} ${demo} GROUP BY r.stars`,
      this.prisma.$queryRaw<{ method: string | null; count: bigint; amount: bigint }[]>`
        SELECT COALESCE(p.method::text, CASE WHEN p.provider = 'WAIVED' THEN 'WAIVED' ELSE 'OTHER' END) AS method, count(*), COALESCE(sum(p.amount_paise), 0)::bigint AS amount
        FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.state = 'PAID' AND p.settled_at >= ${from} ${demo} GROUP BY 1 ORDER BY count(*) DESC`,
      this.prisma.$queryRaw<{ assign_min: number | null; complete_min: number | null }[]>`
        SELECT avg(extract(epoch FROM (b.assigned_at - b.matching_started_at)) / 60) FILTER (WHERE b.assigned_at > b.matching_started_at) AS assign_min,
          avg(extract(epoch FROM (e.at - b.assigned_at)) / 60) FILTER (WHERE e.at > b.assigned_at) AS complete_min
        FROM bookings b LEFT JOIN booking_events e ON e.booking_id = b.id AND e.status = 'COMPLETED'
        WHERE b.created_at >= ${from} ${demo}`,
    ]);

    const names = await this.prisma.user.findMany({ where: { id: { in: techs.map((t) => t.id) } }, select: { id: true, nameEnc: true } });
    const nameOf = new Map<string, string>();
    for (const u of names) nameOf.set(u.id, await this.name(u.nameEnc));

    const f = funnel[0] ?? { created: 0n, paid: 0n, assigned: 0n, completed: 0n };
    const totalRevenue = daily.reduce((s, r) => s + paiseToRupees(r.revenue), 0);
    const created = Number(f.created);
    const completed = Number(f.completed);
    const cancelled = cancels.reduce((s, c) => s + Number(c.count), 0);
    return {
      days: d,
      daily: daily.map((r) => ({
        date: r.day.toISOString().slice(0, 10),
        created: Number(r.created),
        completed: Number(r.completed),
        cancelled: Number(r.cancelled),
        revenue: paiseToRupees(r.revenue),
        newCustomers: Number(r.new_customers),
      })),
      byCategory: byCategory.map((c) => ({ categoryId: c.category_id, bookings: Number(c.bookings), completed: Number(c.completed), revenue: paiseToRupees(c.revenue) })),
      funnel: { created, paid: Number(f.paid), assigned: Number(f.assigned), completed },
      cancelReasons: cancels.map((c) => ({ reason: c.reason ?? 'UNKNOWN', count: Number(c.count) })),
      heatmap: heat.map((h) => ({ dow: h.dow, hour: h.hour, count: Number(h.count) })),
      topAreas: areas.map((a) => ({ area: a.area, bookings: Number(a.bookings) })),
      topTechnicians: techs.map((t) => ({ id: t.id, name: nameOf.get(t.id) ?? '', jobs: Number(t.jobs), rating: t.rating ? Number(t.rating) : null })),
      ratings: [1, 2, 3, 4, 5].map((s) => ({ stars: s, count: Number(ratings.find((r) => r.stars === s)?.count ?? 0) })),
      paymentMethods: methods.map((m) => ({ method: m.method ?? 'OTHER', count: Number(m.count), amount: paiseToRupees(m.amount) })),
      timing: { avgMinToAssign: round1(timing[0]?.assign_min), avgMinToComplete: round1(timing[0]?.complete_min) },
      totals: {
        bookings: created,
        completed,
        revenue: totalRevenue,
        avgTicket: completed ? Math.round(totalRevenue / completed) : 0,
        completionRate: created ? Math.round((completed / created) * 1000) / 10 : 0,
        cancelRate: created ? Math.round((cancelled / created) * 1000) / 10 : 0,
      },
    };
  }

  // ---------- audit log ----------

  async auditLog(q: { search?: string; actor?: string; before?: number }): Promise<{ id: string; at: number; actorType: string; actor: string; action: string; entity: string; entityId: string; ip: string | null; details: string }[]> {
    const search = (q.search ?? '').trim();
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(q.actor && ['CUSTOMER', 'TECHNICIAN', 'COORDINATOR', 'ADMIN', 'SYSTEM'].includes(q.actor) ? { actorType: q.actor as never } : {}),
        ...(search ? { OR: [{ action: { contains: search, mode: 'insensitive' } }, { entityId: search }] } : {}),
        ...(q.before ? { at: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { at: 'desc' },
      take: 100,
    });
    const admins = new Map((await this.prisma.adminUser.findMany({ select: { id: true, displayName: true } })).map((a) => [a.id, a.displayName]));
    return rows.map((r) => ({
      id: String(r.id),
      at: r.at.getTime(),
      actorType: r.actorType,
      actor: r.actorType === 'ADMIN' ? (r.actorId ? (admins.get(r.actorId) ?? 'command line') : 'command line') : r.actorType === 'SYSTEM' ? 'Housefi' : (r.actorId?.slice(0, 8) ?? ''),
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      ip: r.ip,
      // Before/after hold no personal data by design (ids, states, short reasons).
      details: JSON.stringify({ ...(r.before ? { before: r.before } : {}), ...(r.after ? { after: r.after } : {}) }).slice(0, 400),
    }));
  }

  // ---------- arcade ----------

  async saveScore(adminId: string, game: string, score: number, detail: string): Promise<{ best: number; rank: number }> {
    if (!/^[a-z-]{2,30}$/.test(game) || !Number.isInteger(score) || score < 0 || score > 10_000_000) throw new AppError('VALIDATION', { fields: { score: 'INVALID' } });
    await this.prisma.adminGameScore.create({ data: { adminId, game, score, detail: detail.slice(0, 60), createdAt: new Date(this.clock.now()) } });
    const best = (await this.prisma.adminGameScore.aggregate({ where: { adminId, game }, _max: { score: true } }))._max.score ?? score;
    const rank = (await this.prisma.adminGameScore.count({ where: { game, score: { gt: score } } })) + 1;
    return { best, rank };
  }

  async leaderboard(game: string): Promise<{ name: string; score: number; detail: string; at: number }[]> {
    const rows = await this.prisma.adminGameScore.findMany({ where: { game }, orderBy: [{ score: 'desc' }, { createdAt: 'asc' }], take: 10, include: { admin: { select: { displayName: true } } } });
    return rows.map((r) => ({ name: r.admin.displayName, score: r.score, detail: r.detail, at: r.createdAt.getTime() }));
  }

  // ---------- helpers ----------

  private async ticketDto(t: Prisma.SupportTicketGetPayload<{ include: { raiser: { select: { id: true; role: true; nameEnc: true; phoneEnc: true } }; booking: { select: { id: true; code: true; status: true; locality: true; city: true; pincode: true; customerId: true; technicianId: true } } } }>): Promise<TicketDto> {
    const spots: Spot[] = [];
    if (t.lat !== null && t.lng !== null) spots.push({ lat: t.lat, lng: t.lng, accuracyM: t.accuracyM, at: t.locatedAt?.getTime() ?? null, source: 'PHONE' });
    let otherName: string | null = null;
    let otherPhone: string | null = null;
    if (t.booking) {
      const techId = t.booking.technicianId;
      if (techId) {
        const [live] = await this.prisma.$queryRaw<{ lat: number; lng: number; acc: number | null; at: Date | null }[]>`
          SELECT ST_Y(last_location::geometry) AS lat, ST_X(last_location::geometry) AS lng, last_accuracy_m AS acc, last_location_at AS at
          FROM technicians WHERE user_id = ${techId}::uuid AND last_location IS NOT NULL`;
        if (live && live.at && this.clock.now() - live.at.getTime() < LIVE_MS) spots.push({ lat: live.lat, lng: live.lng, accuracyM: live.acc, at: live.at.getTime(), source: 'LIVE' });
      }
      const [home] = await this.prisma.$queryRaw<{ lat: number; lng: number }[]>`
        SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM bookings WHERE id = ${t.booking.id}::uuid AND location IS NOT NULL`;
      if (home) spots.push({ lat: home.lat, lng: home.lng, accuracyM: null, at: null, source: 'ADDRESS' });
      // The other side of the booking (the technician when a customer pressed it, and the other way round).
      const otherId = t.raiser.id === t.booking.customerId ? techId : t.booking.customerId;
      if (otherId) {
        const o = await this.prisma.user.findUnique({ where: { id: otherId }, select: { nameEnc: true, phoneEnc: true } });
        if (o) {
          otherName = await this.name(o.nameEnc);
          otherPhone = o.phoneEnc.length ? await this.cipher.decrypt('users.phone', o.phoneEnc) : null;
        }
      }
    }
    const admin = t.handledBy ? await this.prisma.adminUser.findUnique({ where: { id: t.handledBy }, select: { displayName: true } }) : null;
    return {
      id: t.id,
      kind: t.kind,
      priority: t.priority,
      state: t.state,
      note: t.note,
      createdAt: t.createdAt.getTime(),
      person: {
        id: t.raiser.id,
        role: t.raiser.role,
        name: await this.name(t.raiser.nameEnc),
        phone: t.raiser.phoneEnc.length ? await this.cipher.decrypt('users.phone', t.raiser.phoneEnc) : '',
      },
      booking: t.booking ? { id: t.booking.id, code: t.booking.code, status: t.booking.status, area: `${t.booking.locality}, ${t.booking.city} ${t.booking.pincode}`, otherName, otherPhone } : null,
      spots,
      handledBy: admin?.displayName ?? null,
      handledAt: t.handledAt?.getTime() ?? null,
      resolvedAt: t.resolvedAt?.getTime() ?? null,
      resolution: t.resolution,
    };
  }

  private async name(enc: Uint8Array | null): Promise<string> {
    return enc ? this.cipher.decrypt('users.name', enc) : '';
  }

  private uuid(id: string): string {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    return id;
  }
}

function round1(n: number | null | undefined): number | null {
  return n === null || n === undefined || Number.isNaN(Number(n)) ? null : Math.round(Number(n) * 10) / 10;
}
