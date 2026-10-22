import { Injectable, Optional } from '@nestjs/common';
import { Prisma, type Technician, type TechnicianSkill, type User } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { Hashing } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { MediaUrls } from '../../common/storage/object-store';
import { TECH_ACTIVE } from '../bookings/booking-status';
import { newTechCode, newVerifyToken, verifyTokenHash } from '../identity/identity-codes';
import { PlacesService } from '../places/places.service';
import { UploadsService } from '../uploads/uploads.service';
import { CATEGORY_ORDER, type TechProfileInput } from './technicians.schemas';
import { reviewBy } from './review-window';
import { genderMatches } from '../identity/gender-match';

type Db = Prisma.TransactionClient | PrismaService;
export type TechnicianRow = Technician & { skills: TechnicianSkill[] };

/** openapi.yaml TechProfile. Before the first submission the fields are empty and `verification` is null. */
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
  /** Service area from India Post's directory; null / empty on profiles from before it (the app then asks again). */
  readonly state: string | null;
  readonly district: string | null;
  readonly localities: readonly string[];
  readonly vehicle: string;
  readonly phoneType: 'SMARTPHONE' | 'KEYPAD' | 'NONE';
  readonly verification: Technician['verification'] | null;
  /** null until the first submission. */
  readonly identity: TechIdentityDto | null;
  /** Aadhaar Secure QR check (last 4 digits only), or null when not done yet. */
  readonly aadhaar: { readonly last4: string; readonly nameMatches: boolean; readonly genderMatches: boolean; readonly verifiedAt: number } | null;
  /** When the technician is told the check will be done (ms); they see an approval only from then on. null before the first submission. */
  readonly reviewBy: number | null;
  readonly correctionNote: { readonly en: string; readonly te: string } | null;
  readonly online: boolean;
  readonly rating: number | null;
  readonly jobsDone: number;
}

/** openapi.yaml TechIdentity. */
export interface TechIdentityDto {
  readonly techCode: string;
  readonly legalName: string;
  /** Signed URL of the registration photo (the technician sees it while it is reviewed); '' when there is none. */
  readonly photo: string;
  readonly photoStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly simulated: false;
  readonly correctionRequest: { readonly kind: 'NAME' | 'PHOTO'; readonly note: string; readonly at: number } | null;
}

const byCategoryOrder = (a: string, b: string) => CATEGORY_ORDER.indexOf(a as never) - CATEGORY_ORDER.indexOf(b as never);

@Injectable()
export class TechniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly audit: AuditService,
    private readonly hashing: Hashing,
    private readonly places: PlacesService,
    @InjectClock() private readonly clock: Clock,
    // API only (the command-line tools load this service without storage).
    @Optional() private readonly uploads?: UploadsService,
    @Optional() private readonly media?: MediaUrls,
  ) {}

  /** The profile as the technician app shows it (also used in the sign-in response). */
  async profileOf(user: User, tech?: TechnicianRow | null): Promise<TechProfileDto> {
    const row = tech === undefined ? await this.find(this.prisma, user.id) : tech;
    const phone = await this.cipher.decrypt('users.phone', user.phoneEnc);
    const name = user.nameEnc ? await this.cipher.decrypt('users.name', user.nameEnc) : '';
    if (!row) {
      // Not submitted yet (docs/QUESTIONS.md #17: the contract has no shape for an empty profile).
      return {
        id: user.id, phone, name, gender: 'M', experienceYears: 0, skills: [], city: '', pincode: '', areas: '', state: null, district: null, localities: [], vehicle: '',
        phoneType: 'SMARTPHONE', verification: null, identity: null, aadhaar: null, reviewBy: null, correctionNote: null, online: false, rating: null, jobsDone: 0,
      };
    }
    return {
      id: user.id,
      phone,
      name,
      gender: row.gender,
      experienceYears: row.experienceYears,
      skills: row.skills.map((s) => s.categoryId).sort(byCategoryOrder),
      city: row.city,
      pincode: row.pincode.trim(),
      areas: row.areas,
      state: row.state,
      district: row.district,
      localities: row.localities,
      vehicle: row.vehicleEnc.length > 0 ? await this.cipher.decrypt('technicians.vehicle', row.vehicleEnc) : '',
      phoneType: row.phoneType,
      verification: row.verification,
      identity: await this.identityOf(row),
      aadhaar: row.aadhaarVerifiedAt && row.aadhaarLast4
        ? { last4: row.aadhaarLast4, nameMatches: row.aadhaarNameMatch === true, genderMatches: row.aadhaarGenderMatch !== false, verifiedAt: row.aadhaarVerifiedAt.getTime() }
        : null,
      reviewBy: reviewBy(row.submittedAt.getTime(), user.isDemo),
      correctionNote: row.correctionNoteEn !== null ? { en: row.correctionNoteEn, te: row.correctionNoteTe ?? row.correctionNoteEn } : null,
      online: row.online,
      rating: row.ratingAvg !== null ? Number(row.ratingAvg) : null,
      jobsDone: row.jobsDone,
    };
  }

  private async identityOf(row: TechnicianRow): Promise<TechIdentityDto | null> {
    if (!row.techCode) return null;
    return {
      techCode: row.techCode,
      legalName: row.legalNameEnc ? await this.cipher.decrypt('technicians.legal_name', row.legalNameEnc) : '',
      photo: row.photoUploadId && this.media ? await this.media.photoUrl(row.photoUploadId) : '',
      photoStatus: row.photoStatus,
      simulated: false,
      correctionRequest:
        row.correctionKind && row.correctionAt
          ? { kind: row.correctionKind as 'NAME' | 'PHOTO', note: row.correctionNote ?? '', at: row.correctionAt.getTime() }
          : null,
    };
  }

  async me(userId: string): Promise<TechProfileDto> {
    return this.profileOf(await this.user(userId));
  }

  /**
   * First submission or a correction: saves the profile and puts it (back) into verification. An approved technician
   * who edits goes back to PENDING and offline until reviewed again. Not while on a job.
   *
   * Identity is set once, on the first submission: the permanent Technician ID, the legal name (as on the identity
   * document) and the registration photo, plus the QR verification token. Later submissions cannot change the name or
   * photo (POST /tech/identity-corrections asks support); a new photo is taken only after support allowed one.
   */
  async submit(userId: string, input: TechProfileInput, opts: { photoOwnerId?: string; actor?: { type: 'TECHNICIAN' | 'COORDINATOR'; id: string } } = {}): Promise<TechProfileDto> {
    const user = await this.user(userId);
    const actor = opts.actor ?? { type: 'TECHNICIAN' as const, id: userId };
    const existing = await this.prisma.technician.findUnique({ where: { userId }, select: { techCode: true, photoUploadId: true } });
    const first = !existing?.techCode;
    const needsPhoto = !existing?.photoUploadId;
    let photoId: string | null = null;
    if (needsPhoto && this.uploads) {
      if (!input.photoUploadId) throw new AppError('VALIDATION', { fields: { photoUploadId: 'REQUIRED' } }, 'a registration photo is needed');
      const [photo] = await this.uploads.ready(opts.photoOwnerId ?? userId, [input.photoUploadId], 'PHOTO', 'photoUploadId', 'PROFILE');
      photoId = photo?.id ?? null;
    }
    // The directory's service area (the PIN code must belong to a chosen locality), or the older free-text fields.
    const area = input.state && input.district && input.localities
      ? this.places.serviceArea({ state: input.state, district: input.district, localities: input.localities, pincode: input.pincode })
      : { state: null, district: null, localities: [], city: input.city ?? '', areas: input.areas ?? '' };
    const vehicleEnc = input.vehicle ? await this.cipher.encrypt('technicians.vehicle', input.vehicle) : new Uint8Array(0);
    const nameEnc = first ? await this.cipher.encrypt('users.name', input.name) : null;
    const legalNameEnc = first ? await this.cipher.encrypt('technicians.legal_name', input.name) : null;
    const token = first ? newVerifyToken() : null;
    const tokenEnc = token ? await this.cipher.encrypt('technicians.verify_token', token) : null;
    const now = new Date(this.clock.now());
    for (let attempt = 0; ; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
          if (await this.hasActiveJob(tx, userId)) throw new AppError('CONFLICT', {}, 'finish the current job first');
          const before = await tx.technician.findUnique({ where: { userId }, select: { verification: true, techCode: true, aadhaarGender: true, aadhaarVerifiedAt: true } });
          if (first && before?.techCode) throw new AppError('CONFLICT', {}, 'the profile was submitted meanwhile; reload it');
          const fields = {
            gender: input.gender,
            ...(before?.aadhaarVerifiedAt ? { aadhaarGenderMatch: genderMatches(before.aadhaarGender, input.gender) } : {}),
            experienceYears: input.experienceYears,
            city: area.city,
            pincode: input.pincode,
            areas: area.areas,
            state: area.state,
            district: area.district,
            localities: [...area.localities],
            vehicleEnc,
            verification: 'PENDING' as const,
            correctionNoteEn: null,
            correctionNoteTe: null,
            online: false,
            submittedAt: now,
            verifiedAt: null,
            ...(first && legalNameEnc && token && tokenEnc
              ? { techCode: newTechCode(), legalNameEnc, verifyTokenHash: verifyTokenHash(token), verifyTokenEnc: tokenEnc }
              : {}),
            ...(photoId ? { photoUploadId: photoId, photoStatus: 'PENDING' as const } : {}),
          };
          await tx.technician.upsert({ where: { userId }, create: { userId, ...fields }, update: fields });
          await tx.technicianSkill.deleteMany({ where: { technicianId: userId } });
          await tx.technicianSkill.createMany({ data: input.skills.map((categoryId) => ({ technicianId: userId, categoryId })) });
          if (nameEnc) await tx.user.update({ where: { id: userId }, data: { nameEnc } });
          await this.clearLocation(tx, userId);
          await this.withdrawOffers(tx, userId);
          // An approval waiting for its review time (review-window.ts) is for the old profile: it is not announced.
          await tx.notification.deleteMany({ where: { userId, kind: 'PROFILE_APPROVED', createdAt: { gt: now } } });
          await this.audit.record(
            { actorType: actor.type, actorId: actor.id, action: 'tech.profile_submitted', entity: 'technician', entityId: userId, before: { verification: before?.verification ?? null }, after: { verification: 'PENDING', skills: input.skills, ...(photoId ? { newPhoto: true } : {}) } },
            tx,
          );
        });
        break;
      } catch (e) {
        // A Technician ID that already exists (about one in a billion): draw another.
        const codeTaken = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target ?? '').includes('tech_code');
        if (!codeTaken || attempt >= 5) throw e;
      }
    }
    return this.profileOf(await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }));
  }

  /**
   * A coordinator registers a technician who has no smartphone (they cannot use the app): the account for their
   * number, linked to this coordinator, and the profile, which goes to verification like any other. CONFLICT if the
   * number already has a technician profile or has signed in to the technician app (that account is theirs).
   */
  async registerForCoordinator(coordinatorId: string, phone: string, input: TechProfileInput, phoneType: 'KEYPAD' | 'NONE'): Promise<TechProfileDto> {
    const phoneHash = this.hashing.phone(phone);
    let user = await this.prisma.user.findUnique({ where: { role_phoneHash: { role: 'TECHNICIAN', phoneHash } } });
    if (user && (await this.prisma.technician.findUnique({ where: { userId: user.id }, select: { userId: true } }))) {
      throw new AppError('CONFLICT', {}, 'this number already has a technician profile');
    }
    // Someone who has signed in to the technician app with this number owns that account: they register themselves.
    if (user && (await this.prisma.refreshToken.count({ where: { userId: user.id } })) > 0) {
      throw new AppError('CONFLICT', {}, 'this number already uses the technician app');
    }
    if (!user) {
      try {
        user = await this.prisma.user.create({ data: { role: 'TECHNICIAN', phoneHash, phoneEnc: await this.cipher.encrypt('users.phone', phone) } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('CONFLICT', {}, 'registered meanwhile');
        throw e;
      }
    }
    const profile = await this.submit(user.id, input, { photoOwnerId: coordinatorId, actor: { type: 'COORDINATOR', id: coordinatorId } });
    await this.prisma.technician.update({ where: { userId: user.id }, data: { coordinatorId, phoneType } });
    return { ...profile, phoneType };
  }

  /** Online = ready for job offers. Only APPROVED technicians may go online (else NOT_VERIFIED). */
  async setOnline(userId: string, online: boolean): Promise<TechProfileDto> {
    const user = await this.user(userId);
    const tech = await this.find(this.prisma, userId);
    if (online) {
      if (!tech || tech.verification !== 'APPROVED') throw new AppError('NOT_VERIFIED');
      await this.prisma.technician.update({ where: { userId }, data: { online: true, missedOffersInRow: 0 } });
    } else if (tech) {
      await this.prisma.$transaction(async (tx) => {
        await tx.technician.update({ where: { userId }, data: { online: false } });
        await this.withdrawOffers(tx, userId);
        // Nobody is tracked while offline (a technician on a job keeps sending location regardless).
        if (!(await this.hasActiveJob(tx, userId))) await this.clearLocation(tx, userId);
      });
    }
    return this.profileOf(user);
  }

  /**
   * The phone's position every ~60 s. Stored only while online or on a job (latest point only, no history);
   * otherwise accepted and dropped. Customers never see it before the trip starts (step 9).
   */
  async updateLocation(userId: string, lat: number, lng: number, accuracy: number | undefined): Promise<void> {
    await this.user(userId);
    const tech = await this.prisma.technician.findUnique({ where: { userId }, select: { online: true } });
    if (!tech) return;
    if (!tech.online && !(await this.hasActiveJob(this.prisma, userId))) return;
    const at = new Date(this.clock.now());
    const acc = accuracy === undefined ? null : Math.round(accuracy);
    await this.prisma.$executeRaw`
      UPDATE technicians SET last_location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        last_location_at = ${at}, last_accuracy_m = ${acc}
      WHERE user_id = ${userId}::uuid`;
  }

  /** Account deletion (inside the caller's transaction): CONFLICT while on a job; otherwise offline and wiped. */
  async anonymiseForDeletion(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    if (await this.hasActiveJob(tx, userId)) throw new AppError('CONFLICT', {}, 'a job is still in progress');
    const exists = await tx.technician.findUnique({ where: { userId }, select: { userId: true } });
    if (!exists) return;
    // The Technician ID stays retired (never reused); everything that identifies the person goes, the QR link dies,
    // and the Aadhaar fingerprint is dropped (the person may register again later).
    await tx.technician.update({
      where: { userId },
      data: {
        online: false, vehicleEnc: new Uint8Array(0), areas: '', legalNameEnc: null, verifyTokenHash: null, verifyTokenEnc: null,
        correctionKind: null, correctionNote: null, correctionAt: null,
        aadhaarLast4: null, aadhaarYearOfBirth: null, aadhaarGender: null, aadhaarNameMatch: null, aadhaarGenderMatch: null, aadhaarFingerprint: null, aadhaarVerifiedAt: null,
      },
    });
    // Where payouts went (bank account or UPI) goes too; payouts already made keep only their amounts.
    await tx.technicianPayoutAccount.deleteMany({ where: { technicianId: userId } });
    await this.withdrawOffers(tx, userId);
    await this.clearLocation(tx, userId);
  }

  async hasActiveJob(db: Db, technicianId: string): Promise<boolean> {
    return (await db.booking.count({ where: { technicianId, status: { in: [...TECH_ACTIVE] } } })) > 0;
  }

  find(db: Db, userId: string): Promise<TechnicianRow | null> {
    return db.technician.findUnique({ where: { userId }, include: { skills: true } });
  }

  /** An unavailable technician's open offer is withdrawn (not a miss); dispatch offers the job to someone else. */
  private async withdrawOffers(db: Db, userId: string): Promise<void> {
    await db.jobOffer.updateMany({ where: { technicianId: userId, state: 'OPEN' }, data: { state: 'WITHDRAWN', respondedAt: new Date(this.clock.now()) } });
  }

  private async clearLocation(db: Db, userId: string): Promise<void> {
    await db.$executeRaw`UPDATE technicians SET last_location = NULL, last_location_at = NULL, last_accuracy_m = NULL WHERE user_id = ${userId}::uuid`;
  }

  private async user(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE' || user.role !== 'TECHNICIAN') throw new AppError('UNAUTHENTICATED');
    return user;
  }
}
