// Live support: a conversation between a customer (or technician) and Housefi HQ. The app's assistant first asks what
// it is about (topic, booking, what happened: the intake), then hands over here; HQ answers from the portal. One open
// conversation per person; texts are encrypted; HQ closes it (and may delete it) from the portal.
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type SupportThread } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { Notifier } from '../notifications/notifier';
import type { Raiser } from './support.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SUPPORT_TOPICS = ['BOOKING', 'PAYMENT', 'TECHNICIAN', 'APP', 'OTHER'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export const MAX_SUPPORT_TEXT = 1000;
/** Messages a conversation shows (the newest). */
const SHOWN = 200;
/** "HQ replied" pushes: at most one every few minutes per conversation. */
const PUSH_EVERY_MS = 3 * 60_000;

export interface SupportMessageDto {
  readonly id: string;
  /** For the person: ME, HQ, SYSTEM. For HQ (the portal): PERSON, HQ, SYSTEM. */
  readonly from: 'ME' | 'PERSON' | 'HQ' | 'SYSTEM';
  readonly text: string;
  readonly at: number;
}

export interface SupportConversationDto {
  readonly id: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly topic: SupportTopic;
  readonly bookingCode: string | null;
  readonly createdAt: number;
  readonly messages: readonly SupportMessageDto[];
}

/** The intake as one plain line for HQ ("Payment · HF-48291"). */
function intakeLine(topic: SupportTopic, code: string | null): string {
  const label: Record<SupportTopic, string> = { BOOKING: 'A booking', PAYMENT: 'Payment', TECHNICIAN: 'The technician', APP: 'The app', OTHER: 'Something else' };
  return `About: ${label[topic]}${code ? ` · booking ${code}` : ''}`;
}

@Injectable()
export class SupportChatService {
  private readonly log = new Logger(SupportChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly notifier: Notifier,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** The person's open conversation, or the one HQ closed in the last day (so they see it was closed); else null. */
  async current(who: Raiser): Promise<SupportConversationDto | null> {
    const t = await this.prisma.supportThread.findFirst({
      where: { userId: who.id, OR: [{ state: 'OPEN' }, { closedAt: { gt: new Date(this.clock.now() - 24 * 3_600_000) } }] },
      orderBy: { createdAt: 'desc' },
    });
    if (!t) return null;
    if (t.unreadForUser > 0) await this.prisma.supportThread.update({ where: { id: t.id }, data: { unreadForUser: 0 } });
    return this.view(t, 'USER');
  }

  /** Starts a conversation after the intake (or returns the open one, with the new words added). */
  async start(who: Raiser, input: { topic: SupportTopic; bookingId?: string | null; text: string }): Promise<SupportConversationDto> {
    const text = this.clean(input.text);
    let code: string | null = null;
    let bookingId: string | null = null;
    if (input.bookingId) {
      if (!UUID.test(input.bookingId)) throw new AppError('NOT_FOUND');
      const owner = who.role === 'TECHNICIAN' ? { technicianId: who.id } : { customerId: who.id };
      const b = await this.prisma.booking.findFirst({ where: { id: input.bookingId, ...owner }, select: { id: true, code: true } });
      if (!b) throw new AppError('NOT_FOUND');
      bookingId = b.id;
      code = b.code;
    }
    const open = await this.prisma.supportThread.findFirst({ where: { userId: who.id, state: 'OPEN' } });
    if (open) {
      await this.send(who, text);
      return this.view((await this.prisma.supportThread.findUniqueOrThrow({ where: { id: open.id } })), 'USER');
    }
    const now = new Date(this.clock.now());
    try {
      const t = await this.prisma.$transaction(async (tx) => {
        const thread = await tx.supportThread.create({ data: { userId: who.id, role: who.role, bookingId, topic: input.topic, createdAt: now, lastMessageAt: now, unreadForHq: 1 } });
        await tx.supportMessage.create({ data: { threadId: thread.id, from: 'SYSTEM', bodyEnc: await this.cipher.encrypt('support_messages.body', intakeLine(input.topic, code)), createdAt: now } });
        await tx.supportMessage.create({ data: { threadId: thread.id, from: 'USER', bodyEnc: await this.cipher.encrypt('support_messages.body', text), createdAt: new Date(now.getTime() + 1) } });
        return thread;
      });
      this.log.log(`support conversation ${t.id} started (${input.topic})`);
      return this.view(t, 'USER');
    } catch (e) {
      // Two taps at once: the other one made it (one open conversation per person).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return (await this.current(who))!;
      throw e;
    }
  }

  /** The person writes in their open conversation. */
  async send(who: Raiser, raw: string): Promise<SupportConversationDto> {
    const text = this.clean(raw);
    const t = await this.prisma.supportThread.findFirst({ where: { userId: who.id, state: 'OPEN' } });
    if (!t) throw new AppError('CONFLICT', {}, 'no open conversation: start one from the assistant');
    const now = new Date(this.clock.now());
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { threadId: t.id, from: 'USER', bodyEnc: await this.cipher.encrypt('support_messages.body', text), createdAt: now } }),
      this.prisma.supportThread.update({ where: { id: t.id }, data: { lastMessageAt: now, unreadForHq: { increment: 1 }, unreadForUser: 0 } }),
    ]);
    return this.view(await this.prisma.supportThread.findUniqueOrThrow({ where: { id: t.id } }), 'USER');
  }

  // ---------- HQ (the portal) ----------

  async list(state: 'OPEN' | 'CLOSED'): Promise<{ id: string; userId: string; role: string; name: string; topic: string; bookingId: string | null; unread: number; lastMessageAt: number; createdAt: number; preview: string }[]> {
    const rows = await this.prisma.supportThread.findMany({
      where: { state },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
      include: { user: { select: { nameEnc: true } }, messages: { orderBy: { seq: 'desc' }, take: 1 } },
    });
    return Promise.all(
      rows.map(async (t) => ({
        id: t.id,
        userId: t.userId,
        role: t.role,
        name: t.user.nameEnc ? await this.cipher.decrypt('users.name', t.user.nameEnc) : '',
        topic: t.topic,
        bookingId: t.bookingId,
        unread: t.unreadForHq,
        lastMessageAt: t.lastMessageAt.getTime(),
        createdAt: t.createdAt.getTime(),
        preview: t.messages[0] ? (await this.cipher.decrypt('support_messages.body', t.messages[0].bodyEnc)).slice(0, 120) : '',
      })),
    );
  }

  /** One conversation for HQ (marks it read). */
  async forHq(id: string): Promise<SupportConversationDto & { userId: string; role: string }> {
    const t = await this.thread(id);
    if (t.unreadForHq > 0) await this.prisma.supportThread.update({ where: { id: t.id }, data: { unreadForHq: 0 } });
    return { ...(await this.view(t, 'HQ')), userId: t.userId, role: t.role };
  }

  async reply(id: string, raw: string, adminId: string): Promise<void> {
    const text = this.clean(raw);
    const t = await this.thread(id);
    if (t.state !== 'OPEN') throw new AppError('CONFLICT', {}, 'the conversation is closed');
    const now = new Date(this.clock.now());
    await this.prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({ data: { threadId: t.id, from: 'HQ', adminId, bodyEnc: await this.cipher.encrypt('support_messages.body', text), createdAt: now } });
      await tx.supportThread.update({ where: { id: t.id }, data: { lastMessageAt: now, unreadForUser: { increment: 1 }, unreadForHq: 0 } });
      const recent = await tx.notification.count({ where: { userId: t.userId, kind: 'SUPPORT_REPLY', createdAt: { gt: new Date(now.getTime() - PUSH_EVERY_MS) } } });
      if (recent === 0) await this.notifier.enqueue(tx, [{ userId: t.userId, kind: 'SUPPORT_REPLY', bookingId: null, params: {} }]);
    });
  }

  async close(id: string, adminId: string): Promise<void> {
    const t = await this.thread(id);
    if (t.state === 'CLOSED') return;
    const now = new Date(this.clock.now());
    await this.prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({ data: { threadId: t.id, from: 'SYSTEM', bodyEnc: await this.cipher.encrypt('support_messages.body', 'Conversation closed by Housefi'), createdAt: now } });
      await tx.supportThread.update({ where: { id: t.id }, data: { state: 'CLOSED', closedAt: now, closedBy: adminId, unreadForUser: { increment: 1 } } });
    });
  }

  /** Deleted for good (saves storage): the conversation and every message. */
  async remove(id: string): Promise<void> {
    const t = await this.thread(id);
    await this.prisma.supportThread.delete({ where: { id: t.id } });
  }

  /** Closed conversations older than `days` are deleted (housekeeping, from the portal). */
  async removeClosedOlderThan(days: number): Promise<number> {
    const { count } = await this.prisma.supportThread.deleteMany({ where: { state: 'CLOSED', closedAt: { lt: new Date(this.clock.now() - days * 86_400_000) } } });
    return count;
  }

  // ---------- helpers ----------

  private async thread(id: string): Promise<SupportThread> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    const t = await this.prisma.supportThread.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }

  private clean(raw: string): string {
    const text = raw.trim().replace(/\s+\n/g, '\n');
    if (!text) throw new AppError('VALIDATION', { fields: { text: 'REQUIRED' } });
    if (text.length > MAX_SUPPORT_TEXT) throw new AppError('VALIDATION', { fields: { text: 'INVALID' } });
    return text;
  }

  private async view(t: SupportThread, side: 'USER' | 'HQ'): Promise<SupportConversationDto> {
    const [rows, booking] = await Promise.all([
      this.prisma.supportMessage.findMany({ where: { threadId: t.id }, orderBy: { seq: 'desc' }, take: SHOWN }),
      t.bookingId ? this.prisma.booking.findUnique({ where: { id: t.bookingId }, select: { code: true } }) : null,
    ]);
    const messages: SupportMessageDto[] = [];
    for (const m of rows.reverse()) {
      const from = m.from === 'SYSTEM' ? 'SYSTEM' : m.from === 'HQ' ? 'HQ' : side === 'USER' ? 'ME' : 'PERSON';
      messages.push({ id: m.id, from, text: await this.cipher.decrypt('support_messages.body', m.bodyEnc), at: m.createdAt.getTime() });
    }
    return { id: t.id, state: t.state, topic: t.topic as SupportTopic, bookingCode: booking?.code ?? null, createdAt: t.createdAt.getTime(), messages };
  }
}
