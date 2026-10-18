import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, Upload, UploadKind, UploadStage, UserRole } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { OBJECT_STORE, type ObjectStore, ObjectTooLarge, uploadKey } from '../../common/storage/object-store';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { type AudioType, audioDurationSec, isType, MediaError, type PhotoType, stripLocation } from './media';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** README security checklist: photos up to 8 MB, voice notes up to 2 MB and 60 s. */
export const MAX_BYTES: Readonly<Record<UploadKind, number>> = { PHOTO: 8 * 1024 * 1024, AUDIO: 2 * 1024 * 1024 };
export const MAX_AUDIO_SEC = 60;
/** Upload tickets per person per hour (4 photos and a voice note per booking leaves plenty of room for retries). */
export const TICKETS_PER_HOUR = 40;
/** An upload not used in a booking within this time is deleted (bucket and database). */
export const UNUSED_UPLOAD_TTL_MS = 24 * 60 * 60_000;

/** openapi.yaml UploadTicket. */
export interface UploadTicketDto {
  readonly id: string;
  readonly uploadUrl: string;
  readonly expiresAt: number;
}

export interface TicketInput {
  readonly contentType: string;
  readonly bytes: number;
  readonly stage?: UploadStage;
}

/**
 * Photos and voice notes (README §5): the app asks for a ticket, PUTs the file straight to S3 with the signed URL,
 * then sends the id in a booking or an AI call. The file is checked once, the first time it is used: it must be
 * there, really be the declared type and size, a voice note at most 60 s; a photo loses its location data. A file
 * that fails is deleted and refused. Used files belong to one booking for good; unused ones are deleted after 24 h.
 */
@Injectable()
export class UploadsService {
  private readonly log = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  async ticket(owner: { id: string; role: UserRole }, kind: UploadKind, input: TicketInput): Promise<UploadTicketDto> {
    let stage: UploadStage | null = null;
    if (kind === 'PHOTO') {
      // Customers describe the problem; technicians photograph the inspection and the finished work, and upload their
      // registration photo (PROFILE).
      stage = input.stage ?? (owner.role === 'TECHNICIAN' ? 'INSPECTION' : 'PROBLEM');
      const allowed = owner.role === 'TECHNICIAN' ? stage !== 'PROBLEM' : stage === 'PROBLEM';
      if (!allowed) throw new AppError('VALIDATION', { fields: { stage: 'INVALID' } }, `a ${owner.role.toLowerCase()} cannot upload ${stage} photos`);
    }
    const now = this.clock.now();
    const recent = await this.prisma.upload.findMany({ where: { ownerId: owner.id, createdAt: { gt: new Date(now - 60 * 60_000) } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    if (recent.length >= TICKETS_PER_HOUR) {
      throw new AppError('RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((recent[0]!.createdAt.getTime() + 60 * 60_000 - now) / 1000)) });
    }
    const ttl = this.config.UPLOAD_URL_TTL_SEC;
    const upload = await this.prisma.upload.create({
      data: { ownerId: owner.id, kind, stage, contentType: input.contentType, bytes: input.bytes, createdAt: new Date(now), urlExpiresAt: new Date(now + ttl * 1000) },
    });
    const uploadUrl = await this.store.presignPut(uploadKey(upload.id), input.contentType, input.bytes, ttl);
    return { id: upload.id, uploadUrl, expiresAt: upload.urlExpiresAt.getTime() };
  }

  /**
   * The caller's uploads, checked and ready to use (checking each the first time). NOT_FOUND for an id that is not
   * theirs; VALIDATION on `field` for a file not uploaded yet, refused, already in another booking, or of the wrong
   * kind or stage.
   */
  async ready(ownerId: string, ids: readonly string[], kind: UploadKind, field: string, stage?: UploadStage): Promise<Upload[]> {
    if (new Set(ids).size !== ids.length) throw invalid(field, 'the same file twice');
    const out: Upload[] = [];
    for (const id of ids) {
      if (!UUID.test(id)) throw new AppError('NOT_FOUND', {}, 'no such upload');
      let u = await this.prisma.upload.findFirst({ where: { id, ownerId } });
      if (!u) throw new AppError('NOT_FOUND', {}, 'no such upload');
      if (u.kind !== kind || (stage && u.stage !== stage)) throw invalid(field, `not a ${stage ?? ''} ${kind.toLowerCase()}`.replace('  ', ' '));
      if (u.bookingId) throw invalid(field, 'already used in a booking');
      if (u.state === 'PENDING') u = await this.check(u, field);
      if (u.state === 'REJECTED') throw invalid(field, `file refused: ${u.rejectReason ?? 'unreadable'}`);
      out.push(u);
    }
    return out;
  }

  /** Ties ready uploads to a booking, in its transaction. They can never move to another booking. */
  async attach(tx: Prisma.TransactionClient, bookingId: string, ownerId: string, ids: readonly string[], field: string): Promise<void> {
    if (ids.length === 0) return;
    const r = await tx.upload.updateMany({ where: { id: { in: [...ids] }, ownerId, state: 'READY', bookingId: null }, data: { bookingId } });
    if (r.count !== ids.length) throw invalid(field, 'already used in a booking');
  }

  /** Deletes unused uploads older than 24 h (and refused ones) from the bucket and the database. Returns how many. */
  async sweep(batch = 200): Promise<number> {
    const now = this.clock.now();
    const old = await this.prisma.upload.findMany({
      // A technician's registration photo in use is kept.
      where: { bookingId: null, profileOf: { is: null }, OR: [{ createdAt: { lt: new Date(now - UNUSED_UPLOAD_TTL_MS) } }, { state: 'REJECTED' }] },
      select: { id: true },
      take: batch,
    });
    let n = 0;
    for (const { id } of old) {
      // The row goes first, and only if it is still unused: a booking cannot attach it any more.
      const gone = await this.prisma.upload.deleteMany({ where: { id, bookingId: null, profileOf: { is: null } } });
      if (gone.count === 0) continue;
      await this.store.delete(uploadKey(id)).catch((err: Error) => this.log.warn(`could not delete object for upload ${id} (${err.message})`));
      n++;
    }
    return n;
  }

  /** Account deletion: every upload of the person goes (photos of their home are personal data). Call inside the deletion transaction; delete the returned objects after commit. */
  async forgetUser(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
    const ids = (await tx.upload.findMany({ where: { ownerId: userId }, select: { id: true } })).map((u) => u.id);
    await tx.upload.deleteMany({ where: { ownerId: userId } });
    return ids;
  }

  async deleteObjects(ids: readonly string[]): Promise<void> {
    for (const id of ids) await this.store.delete(uploadKey(id)).catch((err: Error) => this.log.warn(`could not delete object for upload ${id} (${err.message})`));
  }

  /** The one-time check of an uploaded file (outside any transaction: it reads and may rewrite the object). */
  private async check(u: Upload, field: string): Promise<Upload> {
    const key = uploadKey(u.id);
    let bytes: Uint8Array | null;
    try {
      bytes = await this.store.get(key, MAX_BYTES[u.kind]);
    } catch (err) {
      if (err instanceof ObjectTooLarge) return this.reject(u, 'too large');
      throw err;
    }
    if (!bytes) throw invalid(field, 'the file has not been uploaded yet');
    if (bytes.length !== u.bytes) return this.reject(u, 'size differs from the ticket');
    const type = u.contentType as PhotoType | AudioType;
    if (!isType(bytes, type)) return this.reject(u, `not a ${type} file`);
    let durationSec: number | null = null;
    try {
      if (u.kind === 'AUDIO') {
        durationSec = audioDurationSec(bytes, type as AudioType);
        if (durationSec > MAX_AUDIO_SEC) return this.reject(u, `longer than ${MAX_AUDIO_SEC} s`);
      } else {
        const clean = stripLocation(bytes, type as PhotoType);
        if (Buffer.compare(clean, bytes) !== 0) await this.store.put(key, clean, u.contentType);
      }
    } catch (err) {
      if (err instanceof MediaError) return this.reject(u, `unreadable file (${err.message})`);
      throw err;
    }
    await this.prisma.upload.updateMany({ where: { id: u.id, state: 'PENDING' }, data: { state: 'READY', durationSec, verifiedAt: new Date(this.clock.now()) } });
    return this.prisma.upload.findUniqueOrThrow({ where: { id: u.id } });
  }

  private async reject(u: Upload, reason: string): Promise<Upload> {
    await this.store.delete(uploadKey(u.id)).catch(() => undefined);
    await this.prisma.upload.updateMany({ where: { id: u.id, state: 'PENDING' }, data: { state: 'REJECTED', rejectReason: reason } });
    this.log.warn(`upload ${u.id} refused: ${reason}`);
    return this.prisma.upload.findUniqueOrThrow({ where: { id: u.id } });
  }
}

const invalid = (field: string, message: string) => new AppError('VALIDATION', { fields: { [field]: 'INVALID' } }, message);
