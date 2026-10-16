import { Injectable } from '@nestjs/common';
import { Prisma, type User, type UserRole } from '@prisma/client';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { type CustomerDto, UsersService } from '../users/users.service';
import { OtpService, type VerifiedPhone } from './otp.service';
import { type Session, SessionsService } from './sessions.service';

/** openapi.yaml TechProfile. Until the profile is submitted (step 7) the fields are empty and verification is null. */
export interface TechProfileDto {
  readonly id: string;
  readonly phone: string;
  readonly name: string;
  readonly gender: 'M' | 'F';
  readonly experienceYears: number;
  readonly skills: readonly string[];
  readonly city: string;
  readonly pincode: string;
  readonly areas: string;
  readonly vehicle: string;
  readonly phoneType: 'SMARTPHONE' | 'KEYPAD' | 'NONE';
  readonly verification: 'PENDING' | 'APPROVED' | 'NEEDS_CORRECTION' | null;
  readonly correctionNote: { readonly en: string; readonly te: string } | null;
  readonly online: boolean;
  readonly rating: number | null;
  readonly jobsDone: number;
}

/** openapi.yaml AuthResult: exactly one of customer / technician, matching the role. */
export interface AuthResultDto {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly isNew: boolean;
  readonly customer?: CustomerDto;
  readonly technician?: TechProfileDto;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
  ) {}

  /** Sign in or sign up with a verified code: one flow for both. */
  async verifyOtp(challengeId: string, code: string): Promise<AuthResultDto> {
    const verified = await this.otp.verify(challengeId, code);
    const user = await this.findOrCreateUser(verified);
    if (user.status !== 'ACTIVE') throw new AppError('UNAUTHENTICATED', {}, 'account not active');
    return this.result(user, await this.sessions.start(user.id, user.role));
  }

  async refresh(refreshToken: string): Promise<AuthResultDto> {
    const session = await this.sessions.rotate(refreshToken);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    return this.result(user, session);
  }

  /** Revokes the current session and, if given, the session of the presented refresh token (same user only). */
  async logout(userId: string, sessionId: string, refreshToken: string | undefined): Promise<void> {
    await this.sessions.revoke(userId, sessionId);
    if (refreshToken) {
      const family = await this.sessions.familyOf(userId, refreshToken);
      if (family && family !== sessionId) await this.sessions.revoke(userId, family);
    }
  }

  private async findOrCreateUser({ role, phone, phoneHash }: VerifiedPhone): Promise<User> {
    const where = { role_phoneHash: { role, phoneHash } };
    const existing = await this.prisma.user.findUnique({ where });
    if (existing) return existing;
    const phoneEnc = await this.cipher.encrypt('users.phone', phone);
    try {
      return await this.prisma.user.create({ data: { role, phoneHash, phoneEnc } });
    } catch (e) {
      // Two first sign-ins for the same number at once: the other one created the account.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return this.prisma.user.findUniqueOrThrow({ where });
      throw e;
    }
  }

  private async result(user: User, session: Session): Promise<AuthResultDto> {
    const base = { accessToken: session.accessToken, refreshToken: session.refreshToken, expiresIn: session.expiresIn };
    const customer = await this.users.toCustomer(user);
    if (isTechnician(user.role)) {
      return { ...base, isNew: true, technician: emptyTechProfile(user.id, customer.phone, customer.name) };
    }
    return { ...base, isNew: customer.name === '', customer };
  }
}

const isTechnician = (role: UserRole) => role === 'TECHNICIAN';

/** A technician who has not submitted a profile yet. The profile itself arrives with step 7 (PUT /tech/profile). */
function emptyTechProfile(id: string, phone: string, name: string): TechProfileDto {
  return {
    id, phone, name, gender: 'M', experienceYears: 0, skills: [], city: '', pincode: '', areas: '', vehicle: '',
    phoneType: 'SMARTPHONE', verification: null, correctionNote: null, online: false, rating: null, jobsDone: 0,
  };
}
