import { Injectable, Logger } from '@nestjs/common';
import type { Locale, User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AddressesService } from '../addresses/addresses.service';
import { BookingsService } from '../bookings/bookings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { UploadsService } from '../uploads/uploads.service';

/** openapi.yaml Customer: the signed-in person's identity (used for both roles). */
export interface CustomerDto {
  readonly id: string;
  readonly phone: string;
  /** Empty until the name step. */
  readonly name: string;
}

export interface ProfileUpdate {
  readonly name?: string;
  readonly locale?: Locale;
}

@Injectable()
export class UsersService {
  private readonly log = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly addresses: AddressesService,
    private readonly bookings: BookingsService,
    private readonly technicians: TechniciansService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** Decrypts what the API shows about a user. */
  async toCustomer(user: User): Promise<CustomerDto> {
    const phone = await this.cipher.decrypt('users.phone', user.phoneEnc);
    const name = user.nameEnc ? await this.cipher.decrypt('users.name', user.nameEnc) : '';
    return { id: user.id, phone, name };
  }

  /** The signed-in user. A deleted or blocked account is UNAUTHENTICATED, so the app signs out. */
  async me(userId: string): Promise<CustomerDto> {
    return this.toCustomer(await this.active(userId));
  }

  async update(userId: string, change: ProfileUpdate): Promise<CustomerDto> {
    const current = await this.active(userId);
    // Once a technician's profile is submitted, their name is the legal name on the ID card: it changes only
    // through support (identity corrections). Before that it can be set freely.
    if (change.name !== undefined && current.role === 'TECHNICIAN' && (await this.legalNameLocked(userId))) {
      throw new AppError('CONFLICT', {}, 'a technician\'s legal name is locked; ask for a correction instead');
    }
    const data: { nameEnc?: Uint8Array<ArrayBuffer>; locale?: Locale } = {};
    if (change.name !== undefined) data.nameEnc = await this.cipher.encrypt('users.name', change.name);
    if (change.locale !== undefined) data.locale = change.locale;
    const user = await this.prisma.user.update({ where: { id: userId }, data });
    return this.toCustomer(user);
  }

  private async legalNameLocked(userId: string): Promise<boolean> {
    const tech = await this.prisma.technician.findUnique({ where: { userId }, select: { legalNameEnc: true } });
    return !!tech?.legalNameEnc && tech.legalNameEnc.length > 0;
  }

  /**
   * DPDP right to erasure. The row stays (later steps' bookings and payments point to it) but is anonymised:
   * name removed, phone ciphertext wiped, phone hash replaced with random bytes so the number no longer finds this
   * account and can sign up again as a new one. All sessions end, pending sign-in codes are deleted, saved
   * addresses are wiped and bookings anonymised; a technician goes offline and their profile is wiped. CONFLICT while
   * a booking (customer) or a job (technician) is in progress.
   */
  async delete(userId: string): Promise<void> {
    const user = await this.active(userId);
    const now = new Date(this.clock.now());
    const uploads = await this.prisma.$transaction(async (tx) => {
      if (user.role === 'CUSTOMER') await this.bookings.anonymiseForDeletion(tx, userId);
      if (user.role === 'TECHNICIAN') await this.technicians.anonymiseForDeletion(tx, userId);
      await tx.otpChallenge.deleteMany({ where: { phoneHash: user.phoneHash, role: user.role } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await this.addresses.wipeAll(tx, userId);
      // The inbox is the user's own data; devices would only receive pushes for a closed account.
      await tx.device.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      // Stars stay (the technician's average); the free-text comment is the customer's own words.
      await tx.rating.updateMany({ where: { customerId: userId }, data: { comment: '' } });
      await tx.user.update({
        where: { id: userId },
        data: { status: 'DELETED', deletedAt: now, nameEnc: null, phoneEnc: new Uint8Array(0), phoneHash: new Uint8Array(randomBytes(32)) },
      });
      await this.audit.record({ actorType: user.role === 'TECHNICIAN' ? 'TECHNICIAN' : 'CUSTOMER', actorId: userId, action: 'user.delete', entity: 'user', entityId: userId, before: { status: user.status }, after: { status: 'DELETED' } }, tx);
      // Chats they took part in go, both sides' words and photos (no booking of theirs is open: deletion waits for that).
      const chats = { booking: { OR: [{ customerId: userId }, { technicianId: userId }] } };
      const chatPhotos = (await tx.chatMessage.findMany({ where: { ...chats, uploadId: { not: null } }, select: { uploadId: true } })).map((m) => m.uploadId!);
      await tx.chatMessage.deleteMany({ where: chats });
      if (chatPhotos.length) await tx.upload.deleteMany({ where: { id: { in: chatPhotos }, stage: 'CHAT' } });
      // Photos and voice notes (their home, their voice) go too; the files after commit.
      return [...new Set([...chatPhotos, ...(await this.uploads.forgetUser(tx, userId))])];
    });
    await this.uploads.deleteObjects(uploads);
    this.log.log(`account ${userId} deleted and anonymised`);
  }

  private async active(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') throw new AppError('UNAUTHENTICATED');
    return user;
  }
}
