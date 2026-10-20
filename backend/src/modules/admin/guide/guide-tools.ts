// Sarathi's tools. Two kinds, and the difference is the whole security model:
// - LOOK tools read (bookings, people, SOS, chats, numbers) and return facts, with phone numbers masked.
// - ACTION tools never act. They check the request, find the exact target, and write a proposal (admin_actions)
//   that the admin who asked must approve in the portal: one click (LOW), plus typing the confirmation (HIGH), or
//   typing it twice and Windows Hello (CRITICAL). Only GuideActions.execute, called by the approval endpoint, runs it.
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../common/errors/app-error';
import { PrismaService } from '../../../common/prisma/prisma.module';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import { UUID } from '../../bookings/booking-core';
import { AdminBookingsService, type AdminActor } from '../admin-bookings.service';
import { AdminGrowthService } from '../admin-growth.service';
import { AdminOpsService } from '../admin-ops.service';
import { AdminOverviewService } from '../admin-overview.service';
import { AdminPeopleService } from '../admin-people.service';

export type Risk = 'LOW' | 'HIGH' | 'CRITICAL';

/** Arguments after their zod check (each tool's schema above gives the real shape). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly params: z.ZodObject;
  readonly kind: 'look' | 'action';
}

export interface Plan {
  readonly summary: string;
  readonly risk: Risk;
  /** What to type (HIGH, CRITICAL). */
  readonly phrase: string | null;
  /** The resolved arguments that will run (ids, not codes). */
  readonly args: Record<string, unknown>;
}

const booking = z.string().min(3).max(64).describe('Booking code like HF-48291, or the booking id');
const personId = z.uuid().describe('The person id (from find_people or get_booking)');
const reason = z.string().max(200).default('').describe('Why, in a few words (kept in the audit log)');

/** Every tool Sarathi knows: name, what it is for, and its parameters (JSON schema for the model). */
export const TOOLS: readonly ToolSpec[] = [
  // ---------- look ----------
  { name: 'overview', kind: 'look', description: "Today's and this week's numbers: bookings, completed, revenue, live jobs, people, open SOS / reports / queries.", params: z.object({}) },
  { name: 'list_bookings', kind: 'look', description: 'Bookings, newest first. status: ACTIVE, SEARCHING, FINISHED, CANCELLED or ALL. search: part of a booking code.', params: z.object({ status: z.enum(['ACTIVE', 'SEARCHING', 'FINISHED', 'CANCELLED', 'ALL']).default('ACTIVE'), search: z.string().max(20).optional() }) },
  { name: 'get_booking', kind: 'look', description: 'One booking in full: customer, technician, problem, area, payments, history, tickets, what can be done now.', params: z.object({ booking }) },
  { name: 'find_people', kind: 'look', description: 'Find customers or technicians by name or phone number. filter for technicians: ONLINE, PENDING, APPROVED, SUSPENDED, BLOCKED.', params: z.object({ role: z.enum(['customer', 'technician']), search: z.string().max(60).optional(), filter: z.string().max(20).optional() }) },
  { name: 'get_person', kind: 'look', description: "One customer or technician in full: status, bookings, ratings, tickets, earnings (technicians).", params: z.object({ id: personId }) },
  { name: 'list_tickets', kind: 'look', description: 'Emergency SOS (group SOS), reports from technicians and customers (REPORTS), call-back requests (QUERIES). state OPEN or RESOLVED. SOS include where the person was.', params: z.object({ group: z.enum(['SOS', 'REPORTS', 'QUERIES']), state: z.enum(['OPEN', 'RESOLVED']).default('OPEN') }) },
  { name: 'list_conversations', kind: 'look', description: 'Live support conversations with customers / technicians (state OPEN or CLOSED), with unread counts.', params: z.object({ state: z.enum(['OPEN', 'CLOSED']).default('OPEN') }) },
  { name: 'read_conversation', kind: 'look', description: 'Every message of one support conversation.', params: z.object({ id: z.uuid() }) },
  { name: 'list_booking_chats', kind: 'look', description: 'Bookings that have customer–technician chat messages (how many, last message time).', params: z.object({}) },
  { name: 'read_booking_chat', kind: 'look', description: 'The customer–technician chat of one booking (reading it is recorded in the audit log). Only when the admin asks.', params: z.object({ booking }) },
  { name: 'analytics', kind: 'look', description: 'Trends over the last `days` (7 to 365): daily bookings / completed / cancelled / revenue, by category, funnel, cancel reasons, busy hours, top areas, top technicians, ratings, payment methods, timing.', params: z.object({ days: z.number().int().min(7).max(365).default(30) }) },
  { name: 'payouts', kind: 'look', description: 'Weekly technician payouts by state: PENDING (to pay), PAID, FAILED.', params: z.object({ state: z.enum(['PENDING', 'PAID', 'FAILED']).default('PENDING') }) },
  { name: 'services', kind: 'look', description: 'Every service with its visit fee, repair-from price, usual maximum, whether it is on sale, and its booking count.', params: z.object({}) },
  { name: 'coupons', kind: 'look', description: 'Every coupon: code, discount, rules, dates, uses and discount given.', params: z.object({}) },
  { name: 'announcements', kind: 'look', description: 'Announcements sent to customers / technicians, newest first.', params: z.object({}) },
  { name: 'audit_log', kind: 'look', description: 'Who did what and when (the latest 100), optionally searching an action name like "booking_cancel" or an id.', params: z.object({ search: z.string().max(60).optional() }) },

  // ---------- action (proposals only) ----------
  { name: 'cancel_booking', kind: 'action', description: 'Propose cancelling a booking at any stage, optionally refunding the visit fee.', params: z.object({ booking, refund: z.boolean(), reason }) },
  { name: 'send_back_booking', kind: 'action', description: 'Propose taking a job from its technician and searching again.', params: z.object({ booking }) },
  { name: 'assign_booking', kind: 'action', description: 'Propose giving a searching booking to a chosen approved technician.', params: z.object({ booking, technicianId: personId }) },
  { name: 'complete_booking', kind: 'action', description: 'Propose marking a job done (the technician is there and the work was finished outside the app).', params: z.object({ booking }) },
  { name: 'waive_visit_fee', kind: 'action', description: 'Propose Housefi paying the visit fee of a booking waiting for it (the search starts).', params: z.object({ booking }) },
  { name: 'erase_booking', kind: 'action', description: "Propose erasing a booking's personal content (address, notes, voice, photos, chat).", params: z.object({ booking }) },
  { name: 'block_person', kind: 'action', description: 'Propose blocking (or unblocking) a customer or technician account.', params: z.object({ id: personId, blocked: z.boolean(), reason }) },
  { name: 'sign_out_person', kind: 'action', description: 'Propose signing a person out on every phone.', params: z.object({ id: personId }) },
  { name: 'delete_person', kind: 'action', description: 'Propose deleting a customer or technician account for good.', params: z.object({ id: personId }) },
  { name: 'technician_action', kind: 'action', description: 'Propose approve, reject, suspend, reinstate or take offline for a technician (never the Aadhaar check: only the technician can scan it).', params: z.object({ id: personId, action: z.enum(['approve', 'reject', 'suspend', 'reinstate', 'offline']), reason }) },
  { name: 'prepare_payouts', kind: 'action', description: "Propose preparing this week's technician payouts.", params: z.object({}) },
  { name: 'mark_payout', kind: 'action', description: 'Propose marking a payout paid (with the bank / UPI reference) or failed.', params: z.object({ id: z.uuid(), paid: z.boolean(), reference: z.string().max(80).default('') }) },
  { name: 'take_ticket', kind: 'action', description: 'Propose marking an SOS / report / query as being handled by this admin.', params: z.object({ id: z.uuid() }) },
  { name: 'resolve_ticket', kind: 'action', description: 'Propose resolving an SOS / report / query with a note on what was done.', params: z.object({ id: z.uuid(), note: z.string().min(3).max(300) }) },
  { name: 'unlock_start_code', kind: 'action', description: 'Propose unlocking the start code of a booking (after calling both sides).', params: z.object({ booking }) },
  { name: 'reply_conversation', kind: 'action', description: 'Propose sending a reply in a support conversation (the admin sees the exact words first).', params: z.object({ id: z.uuid(), text: z.string().min(1).max(1000) }) },
  { name: 'close_conversation', kind: 'action', description: 'Propose closing a support conversation.', params: z.object({ id: z.uuid() }) },
  { name: 'delete_conversation', kind: 'action', description: 'Propose deleting a support conversation for good.', params: z.object({ id: z.uuid() }) },
  { name: 'delete_booking_chat', kind: 'action', description: "Propose deleting a booking's customer–technician chat for good.", params: z.object({ booking }) },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** "••••••3210": the guide never needs a full number. */
export function maskPhone(p: string): string {
  return p ? `••••••${p.slice(-4)}` : '';
}

/** Phones masked everywhere in a value (keys named phone / otherPhone). */
export function masked<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (k, v) => (typeof v === 'string' && /phone$/i.test(k) ? maskPhone(v) : v)) as T;
}

@Injectable()
export class GuideTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly overview: AdminOverviewService,
    private readonly bookings: AdminBookingsService,
    private readonly people: AdminPeopleService,
    private readonly ops: AdminOpsService,
    private readonly growth: AdminGrowthService,
  ) {}

  /** A LOOK tool's answer, for the model (phones masked, sizes capped). */
  async look(name: string, raw: unknown, by: AdminActor): Promise<unknown> {
    const spec = TOOL_BY_NAME.get(name);
    if (!spec || spec.kind !== 'look') throw new AppError('VALIDATION', {}, `unknown tool ${name}`);
    const a = spec.params.parse(raw ?? {}) as Loose;
    switch (name) {
      case 'overview':
        return { ...(await this.overview.overview()), alerts: await this.ops.alerts() };
      case 'list_bookings': {
        const r = await this.bookings.list({ status: a.status, search: a.search });
        return { total: r.total, bookings: r.rows.slice(0, 30) };
      }
      case 'get_booking': {
        const d = await this.bookings.detail(await this.bookingId(a.booking));
        // The address stays in the portal; the guide gets the area.
        const { address, ...rest } = d.booking as unknown as { address: { city: string; pincode: string } } & Record<string, unknown>;
        return masked({ ...d, booking: { ...rest, area: `${address.city} ${address.pincode}` } });
      }
      case 'find_people': {
        const r = await this.people.list(a.role === 'technician' ? 'TECHNICIAN' : 'CUSTOMER', { search: a.search, filter: a.filter });
        return masked({ total: r.total, people: r.rows.slice(0, 25) });
      }
      case 'get_person':
        return masked(await this.people.detail(a.id));
      case 'list_tickets':
        return masked((await this.ops.tickets(a.group, a.state)).slice(0, 30));
      case 'list_conversations':
        return (await this.ops.conversations(a.state)).slice(0, 30);
      case 'read_conversation':
        return await this.ops.conversation(a.id);
      case 'list_booking_chats':
        return (await this.ops.bookingChats()).slice(0, 30);
      case 'read_booking_chat': {
        const chat = await this.ops.bookingChat(await this.bookingId(a.booking), by);
        return { code: chat.code, messages: chat.messages.map((m) => ({ from: m.from, text: m.text, photo: !!m.photo, at: m.at })) };
      }
      case 'analytics':
        return await this.ops.analytics(a.days, false);
      case 'payouts':
        return (await this.people.payouts(a.state)).slice(0, 50);
      case 'audit_log':
        return (await this.ops.auditLog({ search: a.search })).slice(0, 50);
      case 'services':
        return (await this.growth.services()).map((x) => ({ id: x.id, trade: x.categoryId, name: x.name.en, visitFee: x.visitFee, repairFrom: x.repairFrom, usualMax: x.repairTypicalMax, onSale: x.active, bookings: x.bookings }));
      case 'coupons':
        return await this.growth.coupons();
      case 'announcements':
        return await this.growth.announcements();
    }
    throw new AppError('VALIDATION', {}, `unknown tool ${name}`);
  }

  /** An ACTION tool's proposal: the target checked and named, the risk and what to type. Nothing changes here. */
  async plan(name: string, raw: unknown): Promise<Plan> {
    const spec = TOOL_BY_NAME.get(name);
    if (!spec || spec.kind !== 'action') throw new AppError('VALIDATION', {}, `unknown action ${name}`);
    const a = spec.params.parse(raw ?? {}) as Loose;
    const b = async () => {
      const id = await this.bookingId(a.booking);
      const row = await this.prisma.booking.findUniqueOrThrow({ where: { id }, select: { id: true, code: true, status: true } });
      return row;
    };
    switch (name) {
      case 'cancel_booking': {
        const x = await b();
        return { summary: `Cancel booking ${x.code}${a.refund ? ', refunding the visit fee if it was paid' : ', no refund'}${a.reason ? ` (reason: ${a.reason})` : ''}.`, risk: 'HIGH', phrase: `CANCEL ${x.code}`, args: { bookingId: x.id, refund: a.refund, reason: a.reason || 'by Housefi' } };
      }
      case 'send_back_booking': {
        const x = await b();
        return { summary: `Take ${x.code} from its technician and search for another one now.`, risk: 'HIGH', phrase: `SEND BACK ${x.code}`, args: { bookingId: x.id } };
      }
      case 'assign_booking': {
        const x = await b();
        const t = await this.person(a.technicianId);
        return { summary: `Give booking ${x.code} to technician ${t.name}.`, risk: 'HIGH', phrase: `ASSIGN ${x.code}`, args: { bookingId: x.id, technicianId: t.id } };
      }
      case 'complete_booking': {
        const x = await b();
        return { summary: `Mark booking ${x.code} as done (earnings are written as for any completed job).`, risk: 'HIGH', phrase: `COMPLETE ${x.code}`, args: { bookingId: x.id } };
      }
      case 'waive_visit_fee': {
        const x = await b();
        return { summary: `Housefi pays the visit fee of ${x.code}; the search starts now.`, risk: 'HIGH', phrase: `WAIVE ${x.code}`, args: { bookingId: x.id } };
      }
      case 'erase_booking': {
        const x = await b();
        return { summary: `Erase booking ${x.code}: its address, notes, voice note, photos and chat are deleted for good (cancelled first if still running).`, risk: 'CRITICAL', phrase: `DELETE ${x.code}`, args: { bookingId: x.id } };
      }
      case 'block_person': {
        const p = await this.person(a.id);
        return a.blocked
          ? { summary: `Block ${p.role} ${p.name}: signed out at once, cannot sign in${a.reason ? ` (reason: ${a.reason})` : ''}.`, risk: 'HIGH', phrase: `BLOCK ${p.name}`, args: { id: p.id, blocked: true, reason: a.reason } }
          : { summary: `Unblock ${p.role} ${p.name}: they can sign in again.`, risk: 'HIGH', phrase: `UNBLOCK ${p.name}`, args: { id: p.id, blocked: false, reason: a.reason } };
      }
      case 'sign_out_person': {
        const p = await this.person(a.id);
        return { summary: `Sign ${p.name} out on every phone.`, risk: 'LOW', phrase: null, args: { id: p.id } };
      }
      case 'delete_person': {
        const p = await this.person(a.id);
        return { summary: `Delete the ${p.role} account of ${p.name} for good: name, phone, addresses, photos and chats are erased.`, risk: 'CRITICAL', phrase: `DELETE ${p.name}`, args: { id: p.id } };
      }
      case 'technician_action': {
        const p = await this.person(a.id);
        if (p.role !== 'technician') throw new AppError('VALIDATION', {}, 'not a technician');
        const verb = { approve: 'Approve', reject: 'Reject', suspend: 'Suspend', reinstate: 'Reinstate', offline: 'Take offline' }[String(a.action)] ?? a.action;
        const low = a.action === 'offline';
        return { summary: `${verb} technician ${p.name}${a.reason ? ` (reason: ${a.reason})` : ''}.`, risk: low ? 'LOW' : 'HIGH', phrase: low ? null : `${String(a.action).toUpperCase()} ${p.name}`, args: { id: p.id, action: a.action, reason: a.reason } };
      }
      case 'prepare_payouts':
        return { summary: "Prepare this week's payouts (one per technician for the week to Sunday).", risk: 'LOW', phrase: null, args: {} };
      case 'mark_payout': {
        const row = await this.prisma.payout.findUnique({ where: { id: a.id }, include: { technician: { include: { user: { select: { nameEnc: true } } } } } });
        if (!row) throw new AppError('NOT_FOUND', {}, 'no such payout');
        const name = row.technician.user.nameEnc ? await this.cipher.decrypt('users.name', row.technician.user.nameEnc) : 'technician';
        const amount = Number(row.amountPaise) / 100;
        if (a.paid && String(a.reference).trim().length < 3) throw new AppError('VALIDATION', {}, 'a paid payout needs the bank / UPI reference');
        return a.paid
          ? { summary: `Mark ₹${amount} to ${name} as paid (reference ${a.reference}).`, risk: 'HIGH', phrase: `PAID ${name}`, args: { id: row.id, paid: true, reference: String(a.reference).trim() } }
          : { summary: `Mark ₹${amount} to ${name} as failed (it moves to next Monday).`, risk: 'HIGH', phrase: `FAILED ${name}`, args: { id: row.id, paid: false, reference: '' } };
      }
      case 'take_ticket':
        return { summary: `Mark ticket ${String(a.id).slice(0, 8)} as handled by you.`, risk: 'LOW', phrase: null, args: { id: (await this.ticket(a.id)).id } };
      case 'resolve_ticket': {
        const t = await this.ticket(a.id);
        return { summary: `Resolve the ${t.kind} ticket${t.code ? ` on ${t.code}` : ''} with the note: "${a.note}".`, risk: 'LOW', phrase: null, args: { id: t.id, note: a.note } };
      }
      case 'unlock_start_code': {
        const x = await b();
        return { summary: `Unlock the start code of ${x.code} (only after calling the customer and the technician).`, risk: 'HIGH', phrase: `UNLOCK ${x.code}`, args: { code: x.code } };
      }
      case 'reply_conversation': {
        const c = await this.ops.conversation(a.id);
        return { summary: `Reply in the support conversation (${c.topic.toLowerCase()}${c.bookingCode ? `, ${c.bookingCode}` : ''}): "${a.text}"`, risk: 'LOW', phrase: null, args: { id: c.id, text: a.text } };
      }
      case 'close_conversation':
        return { summary: 'Close the support conversation.', risk: 'LOW', phrase: null, args: { id: (await this.ops.conversation(a.id)).id } };
      case 'delete_conversation':
        return { summary: 'Delete the support conversation and all its messages for good.', risk: 'CRITICAL', phrase: 'DELETE CONVERSATION', args: { id: (await this.ops.conversation(a.id)).id } };
      case 'delete_booking_chat': {
        const x = await b();
        return { summary: `Delete the customer–technician chat of ${x.code} for good.`, risk: 'CRITICAL', phrase: `DELETE CHAT ${x.code}`, args: { bookingId: x.id } };
      }
    }
    throw new AppError('VALIDATION', {}, `unknown action ${name}`);
  }

  // ---------- helpers ----------

  async bookingId(ref: string): Promise<string> {
    const r = String(ref).trim();
    if (UUID.test(r)) return r;
    const digits = r.toUpperCase().replace(/^HF-?/, '');
    if (!/^\d{4,8}$/.test(digits)) throw new AppError('NOT_FOUND', {}, `no booking ${r}`);
    const row = await this.prisma.booking.findUnique({ where: { code: `HF-${digits}` }, select: { id: true } });
    if (!row) throw new AppError('NOT_FOUND', {}, `no booking HF-${digits}`);
    return row.id;
  }

  private async person(id: string): Promise<{ id: string; name: string; role: string }> {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, nameEnc: true, role: true } });
    if (!u || (u.role !== 'CUSTOMER' && u.role !== 'TECHNICIAN')) throw new AppError('NOT_FOUND', {}, 'no such person');
    const name = u.nameEnc ? (await this.cipher.decrypt('users.name', u.nameEnc)).trim() : '';
    return { id: u.id, name: name || `user ${u.id.slice(0, 8)}`, role: u.role === 'TECHNICIAN' ? 'technician' : 'customer' };
  }

  private async ticket(id: string): Promise<{ id: string; kind: string; code: string | null }> {
    const t = await this.prisma.supportTicket.findUnique({ where: { id }, include: { booking: { select: { code: true } } } });
    if (!t) throw new AppError('NOT_FOUND', {}, 'no such ticket');
    return { id: t.id, kind: t.kind, code: t.booking?.code ?? null };
  }
}

/** Runs an approved proposal, through the same services as the portal's buttons. Returns a short result note. */
@Injectable()
export class GuideActions {
  constructor(
    private readonly bookings: AdminBookingsService,
    private readonly people: AdminPeopleService,
    private readonly ops: AdminOpsService,
  ) {}

  async execute(tool: string, args: Record<string, unknown>, by: AdminActor): Promise<string> {
    const s = (k: string) => String(args[k] ?? '');
    switch (tool) {
      case 'cancel_booking':
        await this.bookings.cancel(s('bookingId'), args.refund === true, s('reason'), by);
        return 'Booking cancelled.';
      case 'send_back_booking':
        await this.bookings.sendBack(s('bookingId'), by);
        return 'Sent back to the search.';
      case 'assign_booking':
        await this.bookings.assign(s('bookingId'), s('technicianId'), by);
        return 'Technician assigned.';
      case 'complete_booking':
        await this.bookings.complete(s('bookingId'), by);
        return 'Marked as done.';
      case 'waive_visit_fee':
        await this.bookings.waiveVisitFee(s('bookingId'), by);
        return 'Visit fee waived; searching now.';
      case 'erase_booking':
        await this.bookings.erase(s('bookingId'), by);
        return 'Booking erased.';
      case 'block_person':
        await this.people.block(s('id'), args.blocked === true, s('reason'), by);
        return args.blocked === true ? 'Blocked.' : 'Unblocked.';
      case 'sign_out_person':
        return `Signed out of ${await this.people.signOutEverywhere(s('id'), by)} session(s).`;
      case 'delete_person':
        await this.people.delete(s('id'), by);
        return 'Account deleted.';
      case 'technician_action':
        await this.people.techAction(s('id'), s('action') as never, s('reason'), by);
        return 'Done.';
      case 'prepare_payouts':
        return `${(await this.people.preparePayouts(by)).length} payout(s) ready.`;
      case 'mark_payout':
        if (args.paid === true) await this.people.payoutPaid(s('id'), s('reference'), by);
        else await this.people.payoutFailed(s('id'), by);
        return args.paid === true ? 'Marked paid.' : 'Marked failed.';
      case 'take_ticket':
        await this.ops.takeTicket(s('id'), by);
        return 'You are handling it.';
      case 'resolve_ticket':
        await this.ops.resolveTicket(s('id'), s('note'), by);
        return 'Resolved.';
      case 'unlock_start_code': {
        const r = await this.ops.unlockStart(s('code'), by);
        return `Start code unlocked for ${r.code}.`;
      }
      case 'reply_conversation':
        await this.ops.reply(s('id'), s('text'), by);
        return 'Reply sent.';
      case 'close_conversation':
        await this.ops.closeConversation(s('id'), by);
        return 'Conversation closed.';
      case 'delete_conversation':
        await this.ops.deleteConversation(s('id'), by);
        return 'Conversation deleted.';
      case 'delete_booking_chat':
        await this.ops.deleteBookingChat(s('bookingId'), by);
        return 'Chat deleted.';
    }
    throw new AppError('VALIDATION', {}, `unknown action ${tool}`);
  }
}
