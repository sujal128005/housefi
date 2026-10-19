// Chat between a customer and the technician assigned to their booking: words and photos (instructions, the problem,
// the building gate), so neither has to call for small things.
// - Open from assignment until the job is done (the statuses calls are allowed in); then read-only.
// - Cleared only once the job is done: by either side ("Clear chat"), or by itself 24 h later (ChatWorker). While the
//   job is on, it cannot be cleared.
// - When the job moves to another technician, the new one sees only messages from their assignment on.
// - Text is encrypted like names and addresses; notifications never carry it; photos are the sender's own checked
//   uploads (stage CHAT), shown by short-lived links, and deleted with the chat.
import { Injectable } from '@nestjs/common';
import type { Booking, BookingStatus, UserRole } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { MediaUrls } from '../../common/storage/object-store';
import { UUID } from '../bookings/booking-core';
import { TECH_ACTIVE } from '../bookings/booking-status';
import { Notifier } from '../notifications/notifier';
import { UploadsService } from '../uploads/uploads.service';

/** Finished: the chat is read-only and can be cleared. */
export const CHAT_DONE: readonly BookingStatus[] = ['COMPLETED', 'CLOSED_NO_REPAIR', 'CANCELLED', 'UNFULFILLED'];
/** Cleared by itself this long after the job is done. */
export const CHAT_KEEP_AFTER_DONE_MS = 24 * 60 * 60_000;
export const CHAT_TEXT_MAX = 1000;
/** Messages a person can send in one minute (a stuck button or a flood). */
const PER_MINUTE = 30;
/** One push per this many minutes per booking and side while messages keep coming. */
const PUSH_EVERY_MS = 2 * 60_000;
const BODY_FIELD = 'chat_messages.body';

export type ChatSide = 'CUSTOMER' | 'TECHNICIAN';

/** openapi.yaml ChatMessage. */
export interface ChatMessageDto {
  readonly id: string;
  /** ME: sent by whoever asks; THEM: by the other side. */
  readonly from: 'ME' | 'THEM';
  readonly text: string;
  /** Short-lived link to the photo; null for words only. */
  readonly photo: string | null;
  readonly at: number;
}

/** openapi.yaml Chat. */
export interface ChatDto {
  readonly bookingId: string;
  /** Messages can be sent (the job is on). */
  readonly open: boolean;
  /** The job is done: either side can clear the chat (it is cleared 24 h after the job anyway). */
  readonly clearable: boolean;
  /** When it will be cleared by itself (ms), once the job is done; null while it is on. */
  readonly clearsAt: number | null;
  readonly messages: readonly ChatMessageDto[];
}

/** openapi.yaml ChatSummary: the person's chats with something in them or still open (for the chat bubble). */
export interface ChatSummaryDto {
  readonly bookingId: string;
  readonly code: string;
  readonly open: boolean;
  readonly unread: number;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly media: MediaUrls,
    private readonly uploads: UploadsService,
    private readonly notifier: Notifier,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** The conversation, oldest first; reading it marks it read for this side. */
  async get(userId: string, side: ChatSide, bookingId: string): Promise<ChatDto> {
    const b = await this.booking(userId, side, bookingId);
    await this.markRead(this.prisma, b.id, side, this.clock.now());
    return this.view(userId, b);
  }

  async send(userId: string, side: ChatSide, bookingId: string, input: { text: string; photoUploadId?: string }): Promise<ChatDto> {
    const b = await this.booking(userId, side, bookingId);
    if (!TECH_ACTIVE.includes(b.status)) throw new AppError('CONFLICT', {}, 'the chat is open from assignment until the job is done');
    const text = input.text.trim();
    if (!text && !input.photoUploadId) throw new AppError('VALIDATION', { fields: { text: 'REQUIRED' } }, 'write something or add a photo');
    const now = this.clock.now();
    const lastMinute = await this.prisma.chatMessage.count({ where: { senderId: userId, createdAt: { gt: new Date(now - 60_000) } } });
    if (lastMinute >= PER_MINUTE) throw new AppError('RATE_LIMITED', { retryAfterSec: 60 }, 'too many messages');
    const [photo] = input.photoUploadId ? await this.uploads.ready(userId, [input.photoUploadId], 'PHOTO', 'photoUploadId', 'CHAT') : [];
    const bodyEnc = await this.cipher.encrypt(BODY_FIELD, text);
    const otherId = side === 'CUSTOMER' ? b.technicianId! : b.customerId;
    await this.prisma.$transaction(async (tx) => {
      if (photo) await this.uploads.attach(tx, b.id, userId, [photo.id], 'photoUploadId');
      await tx.chatMessage.create({ data: { bookingId: b.id, senderId: userId, senderRole: side as UserRole, bodyEnc, uploadId: photo?.id ?? null, createdAt: new Date(now) } });
      // A push for the other side (never the text), at most one every couple of minutes while messages keep coming.
      const recent = await tx.notification.count({ where: { userId: otherId, kind: 'CHAT_MESSAGE', bookingId: b.id, createdAt: { gt: new Date(now - PUSH_EVERY_MS) } } });
      if (recent === 0) await this.notifier.enqueue(tx, [{ userId: otherId, kind: 'CHAT_MESSAGE', bookingId: b.id, params: { code: b.code, from: side } }]);
      await this.markRead(tx, b.id, side, now);
    });
    return this.view(userId, await this.booking(userId, side, bookingId));
  }

  /** "Clear chat": only once the job is done. Messages and their photos go for both sides. */
  async clear(userId: string, side: ChatSide, bookingId: string): Promise<void> {
    const b = await this.booking(userId, side, bookingId);
    if (!CHAT_DONE.includes(b.status)) throw new AppError('CONFLICT', {}, 'the chat can be cleared once the job is done');
    await this.erase(b.id);
  }

  /** Chats this person can see that are open or have messages, with unread counts (the floating chat bubble). */
  async mine(userId: string, side: ChatSide): Promise<ChatSummaryDto[]> {
    const rows = await this.prisma.booking.findMany({
      where: {
        ...(side === 'CUSTOMER' ? { customerId: userId } : { technicianId: userId }),
        technicianId: { not: null },
        OR: [{ status: { in: [...TECH_ACTIVE] } }, { chatMessages: { some: {} } }],
      },
      select: { id: true, code: true, status: true, assignedAt: true, chatCustomerReadAt: true, chatTechReadAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const out: ChatSummaryDto[] = [];
    for (const b of rows) {
      const readAt = side === 'CUSTOMER' ? b.chatCustomerReadAt : b.chatTechReadAt;
      const unread = await this.prisma.chatMessage.count({
        where: { bookingId: b.id, senderRole: side === 'CUSTOMER' ? 'TECHNICIAN' : 'CUSTOMER', createdAt: { ...(readAt ? { gt: readAt } : {}), ...(b.assignedAt ? { gte: b.assignedAt } : {}) } },
      });
      out.push({ bookingId: b.id, code: b.code, open: TECH_ACTIVE.includes(b.status), unread });
    }
    return out;
  }

  /** Chats of jobs done more than CHAT_KEEP_AFTER_DONE_MS ago are cleared. Returns how many. */
  async sweep(batch = 100): Promise<number> {
    const cutoff = new Date(this.clock.now() - CHAT_KEEP_AFTER_DONE_MS);
    const done = await this.prisma.booking.findMany({
      // Done (its final status reached) more than a day ago.
      where: { status: { in: [...CHAT_DONE] }, chatMessages: { some: {} }, events: { some: { status: { in: [...CHAT_DONE] }, at: { lt: cutoff } } } },
      select: { id: true },
      take: batch,
    });
    for (const b of done) await this.erase(b.id);
    return done.length;
  }

  private async erase(bookingId: string): Promise<void> {
    const photos = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.chatMessage.findMany({ where: { bookingId, uploadId: { not: null } }, select: { uploadId: true } });
      await tx.chatMessage.deleteMany({ where: { bookingId } });
      const ids = rows.map((r) => r.uploadId!);
      if (ids.length) await tx.upload.deleteMany({ where: { id: { in: ids }, stage: 'CHAT' } });
      await tx.notification.deleteMany({ where: { bookingId, kind: 'CHAT_MESSAGE' } });
      return ids;
    });
    await this.uploads.deleteObjects(photos);
  }

  /** Read up to now, for this side. Raw SQL: it is not a change to the booking (updated_at stays). */
  private async markRead(db: Pick<PrismaService, '$executeRaw'>, bookingId: string, side: ChatSide, now: number): Promise<void> {
    if (side === 'CUSTOMER') await db.$executeRaw`UPDATE bookings SET chat_customer_read_at = ${new Date(now)} WHERE id = ${bookingId}::uuid`;
    else await db.$executeRaw`UPDATE bookings SET chat_tech_read_at = ${new Date(now)} WHERE id = ${bookingId}::uuid`;
  }

  /** The person's own booking (customer) or job (its current technician); NOT_FOUND for anyone else. */
  private async booking(userId: string, side: ChatSide, bookingId: string): Promise<Booking> {
    if (!UUID.test(bookingId)) throw new AppError('NOT_FOUND');
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId, ...(side === 'CUSTOMER' ? { customerId: userId } : { technicianId: userId }) } });
    if (!b) throw new AppError('NOT_FOUND');
    if (!b.technicianId) throw new AppError('CONFLICT', {}, 'the chat opens once a technician is assigned');
    return b;
  }

  private async view(userId: string, b: Booking): Promise<ChatDto> {
    const rows = await this.prisma.chatMessage.findMany({
      // A new technician sees only what was said since they were assigned.
      where: { bookingId: b.id, ...(b.assignedAt ? { createdAt: { gte: b.assignedAt } } : {}) },
      orderBy: { seq: 'asc' },
      take: 500,
    });
    const messages: ChatMessageDto[] = [];
    for (const m of rows) {
      messages.push({
        id: m.id,
        from: m.senderId === userId ? 'ME' : 'THEM',
        text: m.bodyEnc.length > 0 ? await this.cipher.decrypt(BODY_FIELD, m.bodyEnc) : '',
        photo: m.uploadId ? await this.media.photoUrl(m.uploadId) : null,
        at: m.createdAt.getTime(),
      });
    }
    const done = CHAT_DONE.includes(b.status);
    const doneAt = done ? (await this.prisma.bookingEvent.findFirst({ where: { bookingId: b.id, status: b.status }, orderBy: { at: 'desc' }, select: { at: true } }))?.at : null;
    return {
      bookingId: b.id,
      open: TECH_ACTIVE.includes(b.status),
      clearable: done,
      clearsAt: doneAt ? doneAt.getTime() + CHAT_KEEP_AFTER_DONE_MS : null,
      messages,
    };
  }
}
