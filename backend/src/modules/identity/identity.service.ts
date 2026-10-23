// Technician identity: the permanent Housefi Technician ID, the locked legal name and photo, the digital ID card, the
// public QR verification check, correction requests, and Aadhaar offline verification.
//
// The QR code on the ID card links to https://housefi.tech/t/#<token> (VERIFY_PAGE_URL). The page calls
// GET /v1/verify/technicians/{token} and shows the minimum: photo (approved only), first name and last initial,
// Technician ID, gender, and whether the technician may work for Housefi right now. The token is random (about 143
// bits), carries no personal data, is stored as a SHA-256 hash (plus encrypted, so the card shows the same link), and
// can be re-issued, which kills the old one. A suspended technician shows "not active" at once.
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Technician, type TechnicianSkill, type User } from '@prisma/client';
import type { KeyObject } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { MediaUrls } from '../../common/storage/object-store';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { MAX_POINTS } from '../skills/exam-rules';
import { CATEGORY_ORDER } from '../technicians/technicians.schemas';
import type { CertificationDto } from '../technicians/technicians.service';
import { AadhaarQrError, identityFingerprint, namesMatch, uidaiKeys, verifyAadhaarQr } from './aadhaar-qr';
import { displayName, newVerifyToken, VERIFY_TOKEN, verifyTokenHash } from './identity-codes';
import { TechVerificationService } from '../technicians/tech-verification.service';
import { genderMatches } from './gender-match';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Booking statuses in which the customer sees the assigned technician's ID card. */
const CARD_HIDDEN = new Set(['AWAITING_PAYMENT', 'PAYMENT_PENDING', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'CANCELLED']);

type Verification = Technician['verification'];
type TechRow = Technician & { user: User; skills: TechnicianSkill[] };

/** openapi.yaml TechIdCard. */
export interface TechIdCardDto {
  readonly techCode: string;
  readonly name: string;
  readonly photo: string | null;
  readonly photoStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly gender: 'M' | 'F';
  readonly skills: readonly string[];
  /** The trades proven in the skill check (a passed exam, a video HQ approved, or HQ). */
  readonly verifiedSkills: readonly string[];
  /** Certificates HQ approved (ITI, Skill India...). */
  readonly certifications: readonly CertificationDto[];
  readonly verification: Verification;
  readonly simulated: boolean;
  readonly verifyUrl: string;
  readonly verifyIsDemo: false;
  readonly fictional: false;
}

/** openapi.yaml TechVerifyResult. */
export interface TechVerifyResultDto {
  readonly techCode: string;
  readonly displayName: string;
  readonly photo: string | null;
  readonly gender: 'M' | 'F';
  readonly verification: Verification;
  /** Proven trades and approved certificates (shown only while the technician is active). */
  readonly verifiedSkills: readonly string[];
  readonly certifications: readonly CertificationDto[];
  /** True for the team's demo technicians (the page says "Housefi team demo account"). */
  readonly simulated: boolean;
  readonly active: boolean;
  readonly checkedAt: number;
  readonly fictional: false;
  /** The Skill Passport, when the technician switched it on (and is active); null otherwise. */
  readonly passport: PassportDto | null;
}

/** openapi.yaml SkillPassport: the technician's career, as they chose to show it. No contact details, no address. */
export interface PassportDto {
  /** When they joined Housefi (ms). */
  readonly memberSince: number;
  readonly experienceYears: number;
  readonly city: string;
  readonly level: 'UNSKILLED' | 'SEMI_SKILLED' | 'SKILLED' | 'HIGHLY_SKILLED' | null;
  readonly jobsDone: number;
  readonly rating: number | null;
  readonly ratingCount: number;
  /** Each proven trade and how: the skill exam (with its score), a work video Housefi approved, Housefi, or earlier. */
  readonly trades: readonly { readonly categoryId: string; readonly provenBy: 'EXAM' | 'VIDEO' | 'HQ' | 'EARLIER'; readonly examPoints: number | null; readonly examMaxPoints: number | null; readonly at: number }[];
  /** Housefi courses completed. */
  readonly courses: readonly { readonly title: string; readonly at: number }[];
  /** Certificates Housefi checked (ITI, Skill India, other). */
  readonly certificates: readonly CertificationDto[];
}

export interface AadhaarResultDto {
  readonly last4: string;
  readonly nameMatches: boolean;
  /** False when the gender on the Aadhaar differs from the profile: approval waits until the profile is corrected. */
  readonly genderMatches: boolean;
  readonly verifiedAt: number;
}

export interface IdentityActor {
  readonly type: 'TECHNICIAN' | 'COORDINATOR' | 'ADMIN';
  readonly id: string | null;
}

@Injectable()
export class IdentityService {
  private readonly log = new Logger(IdentityService.name);
  private uidai: KeyObject[] | null | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly media: MediaUrls,
    private readonly audit: AuditService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
    private readonly verification: TechVerificationService,
  ) {}

  // ---------- ID card ----------

  /** The signed-in technician's own card. NOT_FOUND before the first profile submission. */
  async idCard(technicianId: string): Promise<TechIdCardDto> {
    const t = await this.tech(technicianId);
    if (!t?.techCode) throw new AppError('NOT_FOUND', {}, 'submit the profile first');
    return this.card(t, true);
  }

  /** The card of the technician assigned to the customer's booking (only while the visit is on or done). */
  async cardForBooking(customerId: string, bookingId: string): Promise<TechIdCardDto> {
    if (!UUID.test(bookingId)) throw new AppError('NOT_FOUND');
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId, customerId }, select: { technicianId: true, status: true } });
    if (!b?.technicianId || CARD_HIDDEN.has(b.status)) throw new AppError('NOT_FOUND');
    const t = await this.tech(b.technicianId);
    if (!t?.techCode) throw new AppError('NOT_FOUND');
    return this.card(t, false);
  }

  private async card(t: TechRow, own: boolean): Promise<TechIdCardDto> {
    return {
      techCode: t.techCode as string,
      name: await this.legalName(t),
      // The technician sees their own photo while it is reviewed; customers only an approved one.
      photo: t.photoUploadId && (own || t.photoStatus === 'APPROVED') ? await this.media.photoUrl(t.photoUploadId) : null,
      photoStatus: t.photoStatus,
      gender: t.gender,
      skills: t.skills.map((s) => s.categoryId).sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b)),
      verifiedSkills: verifiedSkills(t),
      certifications: await this.certifications(t.userId),
      verification: t.verification,
      simulated: t.user.isDemo,
      verifyUrl: `${this.config.VERIFY_PAGE_URL}${await this.token(t)}`,
      verifyIsDemo: false,
      fictional: false,
    };
  }

  // ---------- public verification (the QR code) ----------

  /** What the verification page shows for a scanned card. Unknown or re-issued tokens are NOT_FOUND. */
  async verifyPublic(token: string): Promise<TechVerifyResultDto> {
    if (!VERIFY_TOKEN.test(token)) throw new AppError('NOT_FOUND');
    const t = await this.prisma.technician.findUnique({ where: { verifyTokenHash: verifyTokenHash(token) }, include: { user: true, skills: true } });
    if (!t?.techCode || t.user.status === 'DELETED') throw new AppError('NOT_FOUND');
    const active = t.verification === 'APPROVED' && t.user.status === 'ACTIVE';
    return {
      techCode: t.techCode,
      displayName: displayName(await this.legalName(t)),
      photo: t.photoUploadId && t.photoStatus === 'APPROVED' ? await this.media.photoUrl(t.photoUploadId) : null,
      gender: t.gender,
      verification: t.verification,
      verifiedSkills: active ? verifiedSkills(t) : [],
      certifications: active ? await this.certifications(t.userId) : [],
      simulated: t.user.isDemo,
      active,
      checkedAt: this.clock.now(),
      fictional: false,
      passport: active && t.passportPublic ? await this.passportOf(t) : null,
    };
  }

  // ---------- Skill Passport ----------

  /** The technician's own passport (what the QR page shows when it is on), with the switch and the link. */
  async myPassport(technicianId: string): Promise<{ readonly public: boolean; readonly link: string; readonly passport: PassportDto }> {
    const t = await this.tech(technicianId);
    if (!t?.techCode) throw new AppError('NOT_FOUND', {}, 'submit the profile first');
    return { public: t.passportPublic, link: `${this.config.VERIFY_PAGE_URL}${await this.token(t)}`, passport: await this.passportOf(t) };
  }

  /** Shows or hides the passport on the public QR page. */
  async setPassportPublic(technicianId: string, on: boolean): Promise<{ readonly public: boolean; readonly link: string; readonly passport: PassportDto }> {
    const t = await this.tech(technicianId);
    if (!t?.techCode) throw new AppError('NOT_FOUND', {}, 'submit the profile first');
    if (t.passportPublic !== on) {
      await this.prisma.technician.update({ where: { userId: technicianId }, data: { passportPublic: on } });
      await this.audit.record({ actorType: 'TECHNICIAN', actorId: technicianId, action: on ? 'tech.passport_shown' : 'tech.passport_hidden', entity: 'technician', entityId: technicianId });
    }
    return this.myPassport(technicianId);
  }

  private async passportOf(t: TechRow): Promise<PassportDto> {
    const [exams, certs] = await Promise.all([
      this.prisma.skillExamAttempt.findMany({ where: { technicianId: t.userId, passed: true }, select: { categoryId: true, basePoints: true, bonusPoints: true } }),
      this.prisma.skillCertificate.findMany({ where: { technicianId: t.userId, status: 'APPROVED' }, orderBy: { createdAt: 'asc' }, select: { kind: true, title: true, createdAt: true } }),
    ]);
    const best = new Map<string, number>();
    for (const e of exams) best.set(e.categoryId, Math.max(best.get(e.categoryId) ?? 0, (e.basePoints ?? 0) + (e.bonusPoints ?? 0)));
    return {
      memberSince: t.user.createdAt.getTime(),
      experienceYears: t.experienceYears,
      city: t.city,
      level: t.skillLevel,
      jobsDone: t.jobsDone,
      rating: t.ratingAvg !== null ? Number(t.ratingAvg) : null,
      ratingCount: t.ratingCount,
      trades: t.skills
        .filter((s) => s.verifiedAt)
        .sort((a, b) => CATEGORY_ORDER.indexOf(a.categoryId) - CATEGORY_ORDER.indexOf(b.categoryId))
        .map((s) => {
          const points = s.verifiedVia === 'EXAM' ? best.get(s.categoryId) ?? null : null;
          return { categoryId: s.categoryId, provenBy: s.verifiedVia ?? 'HQ', examPoints: points, examMaxPoints: points !== null ? MAX_POINTS : null, at: s.verifiedAt!.getTime() };
        }),
      courses: certs.filter((c) => c.kind === 'HOUSEFI_COURSE').map((c) => ({ title: c.title.replace(/^Housefi course: /, ''), at: c.createdAt.getTime() })),
      certificates: certs.filter((c) => c.kind !== 'HOUSEFI_COURSE').map((c) => ({ kind: c.kind, title: c.title })),
    };
  }

  private async certifications(technicianId: string): Promise<CertificationDto[]> {
    const rows = await this.prisma.skillCertificate.findMany({ where: { technicianId, status: 'APPROVED' }, orderBy: { createdAt: 'asc' }, select: { kind: true, title: true } });
    return rows.map((c) => ({ kind: c.kind, title: c.title }));
  }

  /** Issues a new QR token; the old link stops working at once (lost phone, screenshot shared). Audited. */
  async reissueToken(technicianId: string, actor: IdentityActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const t = await tx.technician.findUnique({ where: { userId: technicianId }, select: { techCode: true } });
      if (!t?.techCode) throw new AppError('NOT_FOUND');
      await this.issueToken(tx, technicianId);
      await this.audit.record({ actorType: actor.type, actorId: actor.id, action: 'tech.qr_reissued', entity: 'technician', entityId: technicianId, before: {}, after: {} }, tx);
    });
  }

  /** Inside the caller's transaction: a fresh token (hash for lookup, encrypted copy for the card). */
  async issueToken(tx: Prisma.TransactionClient, technicianId: string): Promise<void> {
    const token = newVerifyToken();
    await tx.technician.update({
      where: { userId: technicianId },
      data: { verifyTokenHash: verifyTokenHash(token), verifyTokenEnc: await this.cipher.encrypt('technicians.verify_token', token) },
    });
  }

  private async token(t: Technician): Promise<string> {
    if (t.verifyTokenEnc) return this.cipher.decrypt('technicians.verify_token', t.verifyTokenEnc);
    // Profiles submitted before identity existed get their token the first time the card is shown.
    await this.prisma.$transaction((tx) => this.issueToken(tx, t.userId));
    const fresh = await this.prisma.technician.findUniqueOrThrow({ where: { userId: t.userId }, select: { verifyTokenEnc: true } });
    return this.cipher.decrypt('technicians.verify_token', fresh.verifyTokenEnc as Uint8Array);
  }

  // ---------- corrections ----------

  /** The technician asks support to correct the legal name or photo (they cannot change them directly). */
  async requestCorrection(technicianId: string, kind: 'NAME' | 'PHOTO', note: string): Promise<void> {
    const t = await this.prisma.technician.findUnique({ where: { userId: technicianId }, select: { techCode: true } });
    if (!t?.techCode) throw new AppError('NOT_FOUND', {}, 'submit the profile first');
    await this.prisma.$transaction(async (tx) => {
      await tx.technician.update({ where: { userId: technicianId }, data: { correctionKind: kind, correctionNote: note, correctionAt: new Date(this.clock.now()) } });
      await this.audit.record({ actorType: 'TECHNICIAN', actorId: technicianId, action: 'tech.identity_correction_requested', entity: 'technician', entityId: technicianId, before: {}, after: { kind } }, tx);
    });
  }

  // ---------- Aadhaar offline verification ----------

  /**
   * Checks a scanned Aadhaar Secure QR (UIDAI's signature) for the technician, by the technician themselves or by
   * their coordinator (keypad-phone technicians). Keeps the last 4 digits, birth year, gender, whether the name
   * matches the legal name, and a fingerprint that stops one person from holding two technician accounts. The QR text
   * itself is never stored or logged.
   */
  async verifyAadhaar(technicianId: string, qrText: string, actor: IdentityActor): Promise<AadhaarResultDto> {
    const t = UUID.test(technicianId) ? await this.tech(technicianId) : null;
    // A coordinator only for their own technicians.
    if (!t || (actor.type === 'COORDINATOR' && t.coordinatorId !== actor.id)) throw new AppError('NOT_FOUND');
    if (!t.techCode) throw new AppError('NOT_FOUND', {}, 'submit the profile first');
    const keys = this.uidaiKeys();
    if (!keys) throw new AppError('INTERNAL', {}, 'Aadhaar verification is not configured (UIDAI_QR_CERT_PEM_B64)');
    let details;
    try {
      details = verifyAadhaarQr(qrText, keys);
    } catch (err) {
      if (err instanceof AadhaarQrError) {
        // The month a refused QR was made says which UIDAI certificate it needs (UIDAI_QR_CERT_PEM_B64).
        this.log.warn(`Aadhaar QR refused for technician ${technicianId} (${err.reason}${err.madeIn ? `, QR made ${err.madeIn}` : ''})`);
        throw new AppError('VALIDATION', { fields: { qr: 'INVALID' } }, `not a genuine, readable Aadhaar Secure QR (${err.reason})`);
      }
      throw err;
    }
    const year = new Date(this.clock.now()).getUTCFullYear();
    if (details.yearOfBirth !== null && year - details.yearOfBirth < 18) {
      throw new AppError('VALIDATION', { fields: { qr: 'INVALID' } }, 'technicians must be at least 18');
    }
    const nameMatches = namesMatch(details.name, await this.legalName(t));
    const sameGender = genderMatches(details.gender, t.gender);
    const fingerprint = new Uint8Array(identityFingerprint(details, this.fingerprintKey()));
    const now = new Date(this.clock.now());
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.technician.update({
          where: { userId: technicianId },
          data: {
            aadhaarLast4: details.last4, aadhaarYearOfBirth: details.yearOfBirth, aadhaarGender: details.gender,
            aadhaarNameMatch: nameMatches, aadhaarGenderMatch: sameGender, aadhaarFingerprint: fingerprint, aadhaarVerifiedAt: now,
          },
        });
        await this.audit.record(
          { actorType: actor.type, actorId: actor.id, action: 'tech.aadhaar_verified', entity: 'technician', entityId: technicianId, before: {}, after: { last4: details.last4, nameMatches, genderMatches: sameGender, qrVersion: details.version } },
          tx,
        );
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        this.log.warn(`Aadhaar already linked to another technician account (attempt by ${technicianId})`);
        throw new AppError('CONFLICT', {}, 'this Aadhaar is already linked to another Housefi technician account');
      }
      throw e;
    }
    // Every check passed: approved now (AutoApproveWorker would within a minute), shown at the promised time.
    if (this.config.AUTO_APPROVE_TECHNICIANS && nameMatches && sameGender) await this.verification.approveIfReady(t.userId);
    return { last4: details.last4, nameMatches, genderMatches: sameGender, verifiedAt: now.getTime() };
  }

  private uidaiKeys(): KeyObject[] | null {
    if (this.uidai === undefined) this.uidai = this.config.UIDAI_QR_CERT_PEM_B64 ? uidaiKeys(this.config.UIDAI_QR_CERT_PEM_B64) : null;
    return this.uidai;
  }

  /** Derived from the phone-lookup key with a label, so no extra secret is needed. */
  private fingerprintKey(): Buffer {
    return createHmac('sha256', Buffer.from(this.config.PHONE_HASH_KEY_B64 ?? '', 'base64')).update('housefi:aadhaar-fingerprint:v1').digest();
  }

  // ---------- helpers ----------

  private tech(userId: string): Promise<TechRow | null> {
    return this.prisma.technician.findUnique({ where: { userId }, include: { user: true, skills: true } });
  }

  private async legalName(t: TechRow | (Technician & { user: User })): Promise<string> {
    if (t.legalNameEnc) return this.cipher.decrypt('technicians.legal_name', t.legalNameEnc);
    return t.user.nameEnc ? this.cipher.decrypt('users.name', t.user.nameEnc) : '';
  }
}

function verifiedSkills(t: { readonly skills: readonly TechnicianSkill[] }): string[] {
  return t.skills.filter((s) => s.verifiedAt).map((s) => s.categoryId).sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
}
