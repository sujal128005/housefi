import { Injectable, Logger } from '@nestjs/common';
import type { Locale, User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { AddressesService } from '../addresses/addresses.service';
import { BookingsService } from '../bookings/bookings.service';

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
    await this.active(userId);
    const data: { nameEnc?: Uint8Array<ArrayBuffer>; locale?: Locale } = {};
    if (change.name !== undefined) data.nameEnc = await this.cipher.encrypt('users.name', change.name);
    if (change.locale !== undefined) data.locale = change.locale;
    const user = await this.prisma.user.update({ where: { id: userId }, data });
    return this.toCustomer(user);
  }

  /**
   * DPDP right to erasure. The row stays (later steps' bookings and payments point to it) but is anonymised:
   * name removed, phone ciphertext wiped, phone hash replaced with random bytes so the number no longer finds this
   * account and can sign up again as a new one. All sessions end, pending sign-in codes are deleted, saved
   * addresses are wiped and bookings anonymised. CONFLICT while a booking is in progress.
   * (Technician accounts get their own rules with the technician profile, step 7.)
   */
  async delete(userId: string): Promise<void> {
    const user = await this.active(userId);
    const now = new Date(this.clock.now());
    await this.prisma.$transaction(async (tx) => {
      if (user.role === 'CUSTOMER') await this.bookings.anonymiseForDeletion(tx, userId, now);
      await tx.otpChallenge.deleteMany({ where: { phoneHash: user.phoneHash, role: user.role } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await this.addresses.wipeAll(tx, userId);
      await tx.user.update({
        where: { id: userId },
        data: { status: 'DELETED', deletedAt: now, nameEnc: null, phoneEnc: new Uint8Array(0), phoneHash: new Uint8Array(randomBytes(32)) },
      });
    });
    this.log.log(`account ${userId} deleted and anonymised`);
  }

  private async active(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') throw new AppError('UNAUTHENTICATED');
    return user;
  }
}
