// Telephony (docs/TELEPHONY.md):
// - Job offers by phone call for technicians with a keypad phone: the call says the service, the area (never the
//   address), the time and the earning; 1 then the 4-digit PIN accepts, 2 declines. Call outcomes never accept by
//   themselves: only a keypad accept with the right PIN, through the same transaction as the app's Accept.
// - Busy, no answer or a failed call moves on to the next technician at once. Calls that keep failing to be placed
//   open a circuit breaker: calling pauses, app technicians and coordinators take over.
// - Masked calls: customer and assigned technician call each other through the Housefi number; the provider asks us
//   whom to connect, so neither ever sees the other's number.
// - Keypad technicians go online / offline by calling the Housefi number (1 / 2), or their coordinator sets it.
import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import type { BookingStatus, CallState } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { Hashing } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingCore, UUID } from '../bookings/booking-core';
import { DispatchService, MISSED_OFFERS_LIMIT } from '../dispatch/dispatch.service';
import { istHour } from '../slots/slot-rules';
import { TELEPHONY_PROVIDER, type TelephonyProvider } from './telephony-provider';

/** Visits in which the customer and the technician may call each other. */
const CALLABLE: readonly BookingStatus[] = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK', 'PAYMENT_DUE'];
/** Wrong PINs per call, and per technician in 24 hours, before phone acceptance stops (their coordinator is told). */
const PIN_TRIES_PER_CALL = 3;
const PIN_FAILURES_PER_DAY = 6;
const DAY_MS = 86_400_000;

/** What the provider sent, as plain strings (query or JSON body). */
export type CallbackParams = Readonly<Record<string, string | undefined>>;

/** The answer to a Passthru step: 200 takes the flow's "yes" branch, 302 the other. */
export type Branch = 'yes' | 'no';

const tenDigits = (n: string | undefined) => (n ?? '').replace(/\D/g, '').slice(-10);
const digitsOf = (v: string | undefined) => (v ?? '').replace(/[^0-9]/g, '');

@Injectable()
export class TelephonyService implements OnModuleInit {
  private readonly log = new Logger(TelephonyService.name);
  /** Consecutive calls that could not be placed, and until when calling is paused. */
  private failures = 0;
  private pausedUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: BookingCore,
    private readonly dispatch: DispatchService,
    private readonly cipher: FieldCipher,
    private readonly hashing: Hashing,
    private readonly audit: AuditService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
    @Optional() @Inject(TELEPHONY_PROVIDER) private readonly provider: TelephonyProvider | null,
  ) {}

  onModuleInit(): void {
    if (this.provider) this.dispatch.usePhoneOffers({ available: () => this.available(), place: (id) => this.placeOfferCall(id) });
  }

  /** Calls can be placed now: a provider is configured and the circuit breaker is closed. */
  available(): boolean {
    return this.provider !== null && Date.now() >= this.pausedUntil;
  }

  // ---------- outbound offer calls ----------

  /** Places the call for a new phone offer. Never throws: a call that cannot be placed withdraws the offer. */
  async placeOfferCall(offerId: string): Promise<void> {
    if (!this.provider) return;
    const offer = await this.prisma.jobOffer.findUnique({ where: { id: offerId }, include: { technician: { include: { user: true } } } });
    if (!offer || offer.state !== 'OPEN' || offer.channel !== 'IVR') return;
    const attempt = await this.prisma.offerCallAttempt.create({ data: { offerId, provider: this.provider.name, requestedAt: new Date(this.clock.now()) } });
    try {
      const to = await this.cipher.decrypt('users.phone', offer.technician.user.phoneEnc);
      const { callId } = await this.provider.callForOffer({
        to,
        attemptId: attempt.id,
        statusCallbackUrl: this.callbackUrl('status'),
        ringTimeoutSec: this.config.IVR_RING_TIMEOUT_SEC,
        timeLimitSec: Math.max(60, this.config.IVR_OFFER_TIMEOUT_SEC + 30),
      });
      await this.prisma.offerCallAttempt.update({ where: { id: attempt.id }, data: { providerCallId: callId } });
      this.failures = 0;
    } catch (err) {
      this.log.warn(`offer call not placed (${(err as Error).message})`);
      await this.prisma.offerCallAttempt.update({ where: { id: attempt.id }, data: { state: 'FAILED', failureReason: 'not placed', endedAt: new Date(this.clock.now()) } });
      this.failures++;
      if (this.failures >= this.config.IVR_CIRCUIT_FAILURES) {
        this.pausedUntil = Date.now() + this.config.IVR_CIRCUIT_OPEN_MIN * 60_000;
        this.failures = 0;
        this.log.error(`ALERT phone calls failed ${this.config.IVR_CIRCUIT_FAILURES} times in a row; calling paused for ${this.config.IVR_CIRCUIT_OPEN_MIN} min (app technicians and coordinators only)`);
      }
      // Not the technician's fault: withdrawn, not a miss. The next technician is offered at once.
      await this.endOffer(offerId, 'WITHDRAWN', false);
    }
  }

  // ---------- provider callbacks ----------

  /** The words the offer call speaks (Exotel Greeting with dynamic text). Area only, never the address. */
  async offerPrompt(p: CallbackParams): Promise<string> {
    const found = await this.attemptFor(p);
    if (!found) return 'Sorry, this job is no longer available. Goodbye.';
    const { offer } = found;
    const b = await this.prisma.booking.findUniqueOrThrow({ where: { id: offer.bookingId }, include: { service: true } });
    const te = found.locale === 'te';
    const when =
      b.timeMode === 'INSTANT'
        ? te ? 'ఇప్పుడే' : 'now'
        : `${te ? '' : 'on '}${b.windowDate?.toISOString().slice(0, 10) ?? ''} ${b.windowStartHour ?? ''}:00 ${te ? 'నుండి' : 'to'} ${b.windowEndHour ?? ''}:00`;
    const earning = this.config.TECH_VISIT_SHARE_RUPEES;
    return te
      ? `హౌస్‌ఫై కొత్త పని. ${b.service.nameTe}. ప్రాంతం ${b.locality}, పిన్ ${b.pincode.split('').join(' ')}. సమయం ${when}. విజిట్ సంపాదన ${earning} రూపాయలు. ఒప్పుకోవడానికి 1 నొక్కండి. వద్దనుకుంటే 2 నొక్కండి.`
      : `New Housefi job. ${b.service.nameEn}. Area ${b.locality}, PIN ${b.pincode.split('').join(' ')}. Time ${when}. Visit earning ${earning} rupees. Press 1 to accept. Press 2 to decline.`;
  }

  /** First keypress: 1 = go on to the PIN (yes), 2 = decline, anything else = no change. */
  async offerChoice(p: CallbackParams): Promise<Branch> {
    const found = await this.attemptFor(p);
    if (!found) return 'no';
    const key = digitsOf(p.digits).slice(0, 1);
    if (key === '1') return found.offer.state === 'OPEN' && found.offer.expiresAt.getTime() > this.clock.now() ? 'yes' : 'no';
    if (key === '2') {
      await this.prisma.offerCallAttempt.update({ where: { id: found.attempt.id }, data: { keypadResult: 'REJECT' } });
      await this.dispatch.reject(found.offer.technicianId, found.offer.id, 'OTHER');
      return 'no';
    }
    await this.prisma.offerCallAttempt.update({ where: { id: found.attempt.id }, data: { keypadResult: key ? 'INVALID' : 'NONE' } });
    return 'no';
  }

  /** The 4-digit PIN after pressing 1. Right PIN and the job still free: assigned (yes). Otherwise no. */
  async offerPin(p: CallbackParams): Promise<Branch> {
    const found = await this.attemptFor(p);
    if (!found) return 'no';
    const { attempt, offer } = found;
    const tech = await this.prisma.technician.findUnique({ where: { userId: offer.technicianId }, select: { ivrPinHash: true, coordinatorId: true } });
    const since = new Date(this.clock.now() - DAY_MS);
    const failedToday = await this.prisma.offerCallAttempt.count({ where: { keypadResult: 'PIN_FAILED', requestedAt: { gt: since }, offer: { technicianId: offer.technicianId } } });
    if (!tech?.ivrPinHash || attempt.pinAttempts >= PIN_TRIES_PER_CALL || failedToday >= PIN_FAILURES_PER_DAY) return 'no';
    const pin = digitsOf(p.digits).slice(0, 4);
    if (pin.length !== 4 || !this.pinMatches(offer.technicianId, pin, tech.ivrPinHash)) {
      const tries = attempt.pinAttempts + 1;
      await this.prisma.offerCallAttempt.update({ where: { id: attempt.id }, data: { pinAttempts: tries, ...(tries >= PIN_TRIES_PER_CALL ? { keypadResult: 'PIN_FAILED' } : {}) } });
      if (tries >= PIN_TRIES_PER_CALL) this.log.warn(`wrong job PIN ${PIN_TRIES_PER_CALL} times on an offer call (technician ${offer.technicianId})`);
      return 'no';
    }
    const won = await this.dispatch.acceptByPhone(offer.technicianId, offer.id);
    await this.prisma.offerCallAttempt.update({ where: { id: attempt.id }, data: { keypadResult: won ? 'ACCEPT' : 'TOO_LATE' } });
    // The keypad phone gets the job details by SMS (the address is shared only now, after acceptance).
    if (won) void this.smsJobDetails(offer.technicianId, offer.bookingId).catch((err: Error) => this.log.warn(`job SMS not sent (${err.message})`));
    return won ? 'yes' : 'no';
  }

  /**
   * Call progress (Exotel StatusCallback). Deduplicated, safe out of order: a late "ringing" after "completed" changes
   * nothing. An unanswered or busy call ends the offer and the next technician is offered.
   */
  async callStatus(p: CallbackParams): Promise<void> {
    const callId = p.CallSid ?? p.CallSidV2;
    const status = (p.Status ?? p.CallStatus ?? p.EventType ?? '').toLowerCase();
    if (!callId || !status) return;
    const eventId = `${callId}:${status}`;
    const fresh = await this.prisma.$executeRaw`INSERT INTO telephony_events (event_id, received_at) VALUES (${eventId}, ${new Date(this.clock.now())}) ON CONFLICT DO NOTHING`;
    if (fresh === 0) return;
    const attempt = await this.prisma.offerCallAttempt.findUnique({ where: { providerCallId: callId }, include: { offer: true } });
    if (!attempt) return;
    const now = new Date(this.clock.now());
    const map: Record<string, CallState> = {
      ringing: 'RINGING', 'in-progress': 'ANSWERED', answered: 'ANSWERED', completed: 'COMPLETED', busy: 'BUSY', 'no-answer': 'NO_ANSWER', failed: 'FAILED', canceled: 'CANCELLED',
    };
    const state = map[status];
    if (!state) return;
    const terminal = ['COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELLED'].includes(state);
    const done = ['COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELLED'].includes(attempt.state);
    if (done) return;
    await this.prisma.offerCallAttempt.update({
      where: { id: attempt.id },
      data: {
        state,
        ...(state === 'ANSWERED' ? { answeredAt: now } : {}),
        ...(terminal ? { endedAt: now, durationS: Number.parseInt(p.ConversationDuration ?? p.DialCallDuration ?? '', 10) || null } : {}),
      },
    });
    if (!terminal || attempt.offer.state !== 'OPEN') return;
    // Busy: not counted as a miss. No answer / failed / hung up without a decision: counted like an unanswered app offer.
    await this.endOffer(attempt.offerId, state === 'FAILED' ? 'WITHDRAWN' : 'EXPIRED', state !== 'BUSY' && state !== 'FAILED');
  }

  /**
   * Masked calls (Exotel Connect step with a dynamic URL): the caller dialled the Housefi number; connect them to
   * the other side of a call they asked for in the app, if any. Null = nobody to connect (the flow says so).
   */
  async connectTarget(p: CallbackParams): Promise<string | null> {
    const from = tenDigits(p.CallFrom ?? p.From);
    if (from.length !== 10) return null;
    const callers = await this.prisma.user.findMany({ where: { phoneHash: this.hashing.phone(from), status: 'ACTIVE' }, select: { id: true } });
    if (callers.length === 0) return null;
    const grant = await this.prisma.callGrant.findFirst({
      where: { callerId: { in: callers.map((c) => c.id) }, expiresAt: { gt: new Date(this.clock.now()) }, booking: { status: { in: [...CALLABLE] } } },
      orderBy: { createdAt: 'desc' },
    });
    if (!grant) return null;
    const callee = await this.prisma.user.findUnique({ where: { id: grant.calleeId } });
    if (!callee || callee.status !== 'ACTIVE') return null;
    return `+91${await this.cipher.decrypt('users.phone', callee.phoneEnc)}`;
  }

  /** Inbound availability line for keypad technicians: 1 = start taking jobs, 2 = stop. Yes = done. */
  async availabilityByPhone(p: CallbackParams): Promise<Branch> {
    const from = tenDigits(p.CallFrom ?? p.From);
    const key = digitsOf(p.digits).slice(0, 1);
    if (from.length !== 10 || (key !== '1' && key !== '2')) return 'no';
    const user = await this.prisma.user.findUnique({ where: { role_phoneHash: { role: 'TECHNICIAN', phoneHash: this.hashing.phone(from) } } });
    if (!user || user.status !== 'ACTIVE') return 'no';
    const tech = await this.prisma.technician.findUnique({ where: { userId: user.id } });
    if (!tech || tech.phoneType !== 'KEYPAD') return 'no';
    if (key === '1' && tech.verification !== 'APPROVED') return 'no';
    await this.setOnline(user.id, key === '1', 'IVR', { type: 'TECHNICIAN', id: user.id });
    return 'yes';
  }

  // ---------- masked calls (app) ----------

  /**
   * The customer or the assigned technician asks to call the other: the number to dial (openapi dialNumber). With
   * masked calls (Exotel) it is the Housefi number, which connects them without either seeing the other's number.
   * Without them (TELEPHONY_PROVIDER=off, the pilot) it is the other person's own number, so the phone app calls them
   * directly: only from assignment until payment (CALLABLE), never shown as text in the app, and audited (who called
   * whom for which booking, never the number).
   */
  async grantCall(userId: string, role: 'CUSTOMER' | 'TECHNICIAN', bookingId: string): Promise<{ dialNumber: string }> {
    if (!UUID.test(bookingId)) throw new AppError('NOT_FOUND');
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId, ...(role === 'CUSTOMER' ? { customerId: userId } : { technicianId: userId }) } });
    if (!b) throw new AppError('NOT_FOUND');
    if (!b.technicianId || !CALLABLE.includes(b.status)) throw new AppError('CONFLICT', {}, 'calls are possible from assignment until payment');
    const calleeId = role === 'CUSTOMER' ? b.technicianId : b.customerId;
    if (!this.provider || !this.config.EXOTEL_CALLER_ID) {
      const callee = await this.prisma.user.findUnique({ where: { id: calleeId }, select: { phoneEnc: true, status: true } });
      if (!callee || callee.status !== 'ACTIVE') throw new AppError('CONFLICT', {}, 'this person cannot be called now');
      await this.audit.record({ actorType: role, actorId: userId, action: 'call.direct', entity: 'booking', entityId: b.id, after: { callee: role === 'CUSTOMER' ? 'TECHNICIAN' : 'CUSTOMER' } });
      return { dialNumber: `+91${await this.cipher.decrypt('users.phone', callee.phoneEnc)}` };
    }
    const now = this.clock.now();
    await this.prisma.callGrant.create({
      data: {
        bookingId: b.id,
        callerId: userId,
        calleeId,
        expiresAt: new Date(now + this.config.MASKED_CALL_GRANT_MIN * 60_000),
        createdAt: new Date(now),
      },
    });
    return { dialNumber: this.config.EXOTEL_CALLER_ID };
  }

  /** The number shown in Booking / Job maskedPhone: the Housefi number, or '' when calls are off. */
  maskedNumber(): string {
    return this.provider && this.config.EXOTEL_CALLER_ID ? this.config.EXOTEL_CALLER_ID : '';
  }

  // ---------- keypad technicians (coordinator) ----------

  /** A coordinator sets up one of their technicians for phone offers: phone type, PIN, calling hours, consent. Audited. */
  async phoneSetup(
    coordinatorId: string,
    technicianId: string,
    input: { phoneType: 'SMARTPHONE' | 'KEYPAD' | 'NONE'; pin?: string; callHours?: { start: number; end: number }; consent: boolean },
  ): Promise<void> {
    const tech = await this.ownTechnician(coordinatorId, technicianId);
    if (input.phoneType === 'KEYPAD') {
      if (!input.consent) throw new AppError('VALIDATION', { fields: { consent: 'REQUIRED' } }, 'consent to automated job calls is needed');
      if (!input.pin && !tech.ivrPinHash) throw new AppError('VALIDATION', { fields: { pin: 'REQUIRED' } });
    }
    if (input.pin && (!/^[0-9]{4}$/.test(input.pin) || /^(\d)\1{3}$/.test(input.pin) || ['1234', '4321', '0123', '9876'].includes(input.pin))) {
      throw new AppError('VALIDATION', { fields: { pin: 'INVALID' } }, 'a 4-digit PIN that is not easy to guess');
    }
    if (input.callHours && !(input.callHours.start >= 0 && input.callHours.end <= 24 && input.callHours.start < input.callHours.end)) {
      throw new AppError('VALIDATION', { fields: { callHours: 'INVALID' } });
    }
    const now = new Date(this.clock.now());
    await this.prisma.$transaction(async (tx) => {
      await tx.technician.update({
        where: { userId: technicianId },
        data: {
          phoneType: input.phoneType,
          ...(input.pin ? { ivrPinHash: this.pinHash(technicianId, input.pin) } : {}),
          ...(input.callHours ? { callHoursStart: input.callHours.start, callHoursEnd: input.callHours.end } : {}),
          ...(input.phoneType === 'KEYPAD' ? { ivrConsentAt: now } : {}),
        },
      });
      await this.audit.record(
        {
          actorType: 'COORDINATOR', actorId: coordinatorId, action: 'tech.phone_setup', entity: 'technician', entityId: technicianId,
          before: { phoneType: tech.phoneType }, after: { phoneType: input.phoneType, pinChanged: Boolean(input.pin), callHours: input.callHours ?? null },
        },
        tx,
      );
    });
  }

  /** Online / offline on a technician's behalf (coordinator), or by phone (IVR). Audited. */
  async setOnline(technicianId: string, online: boolean, source: 'IVR' | 'COORDINATOR', actor: { type: 'TECHNICIAN' | 'COORDINATOR'; id: string }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const t = await tx.technician.findUnique({ where: { userId: technicianId } });
      if (!t) throw new AppError('NOT_FOUND');
      if (online && t.verification !== 'APPROVED') throw new AppError('NOT_VERIFIED');
      await tx.technician.update({ where: { userId: technicianId }, data: { online, availabilitySource: source, ...(online ? { missedOffersInRow: 0 } : {}) } });
      if (!online) await tx.jobOffer.updateMany({ where: { technicianId, state: 'OPEN' }, data: { state: 'WITHDRAWN', respondedAt: new Date(this.clock.now()) } });
      await this.audit.record({ actorType: actor.type, actorId: actor.id, action: 'tech.availability', entity: 'technician', entityId: technicianId, before: { online: t.online }, after: { online, source } }, tx);
    });
  }

  /** The coordinator's own technician, online or offline on their behalf. */
  async setOnlineFor(coordinatorId: string, technicianId: string, online: boolean): Promise<void> {
    await this.ownTechnician(coordinatorId, technicianId);
    await this.setOnline(technicianId, online, 'COORDINATOR', { type: 'COORDINATOR', id: coordinatorId });
  }

  /** Keypad technicians whose calling hours ended go offline (SYSTEM), so nobody is called at night. */
  async endCallingHours(): Promise<number> {
    const hour = istHour(this.clock.now());
    const rows = await this.prisma.technician.findMany({
      where: { phoneType: 'KEYPAD', online: true, OR: [{ callHoursEnd: { lte: hour } }, { callHoursStart: { gt: hour } }] },
      select: { userId: true },
    });
    for (const r of rows) {
      await this.prisma.technician.update({ where: { userId: r.userId }, data: { online: false, availabilitySource: 'SYSTEM' } });
    }
    return rows.length;
  }

  // ---------- internals ----------

  /**
   * Job details SMS after a phone acceptance: booking code, customer first name and the address (MSG91 Flow API with
   * a DLT-approved template, MSG91_JOB_TEMPLATE_ID, variables code / name / address). Without a template it is
   * skipped and logged; the coordinator reads the details to the technician.
   */
  private async smsJobDetails(technicianId: string, bookingId: string): Promise<void> {
    const key = this.config.MSG91_AUTH_KEY;
    const template = this.config.MSG91_JOB_TEMPLATE_ID;
    if (!key || !template) {
      this.log.warn('job details SMS skipped (MSG91_JOB_TEMPLATE_ID not set); the coordinator shares the address');
      return;
    }
    const [tech, b] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: technicianId } }),
      this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { customer: true } }),
    ]);
    const to = await this.cipher.decrypt('users.phone', tech.phoneEnc);
    const address = JSON.parse(await this.cipher.decrypt('bookings.address', b.addressSnapshotEnc)) as { house?: string; street?: string; landmark?: string; city?: string; pincode?: string };
    const customer = b.customer.nameEnc ? (await this.cipher.decrypt('users.name', b.customer.nameEnc)).split(' ')[0] : 'Customer';
    const res = await fetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        template_id: template,
        short_url: '0',
        recipients: [{ mobiles: `91${to}`, code: b.code, name: customer, address: [address.house, address.street, address.landmark, address.city, address.pincode].filter(Boolean).join(', ').slice(0, 120) }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`MSG91 HTTP ${res.status}`);
  }

  /** The offer call a callback belongs to (CustomField = our attempt id; or the provider call id). */
  private async attemptFor(p: CallbackParams) {
    const custom = (p.CustomField ?? '').replace(/^"|"$/g, '');
    const attempt = UUID.test(custom)
      ? await this.prisma.offerCallAttempt.findUnique({ where: { id: custom }, include: { offer: true } })
      : p.CallSid
        ? await this.prisma.offerCallAttempt.findUnique({ where: { providerCallId: p.CallSid }, include: { offer: true } })
        : null;
    if (!attempt) return null;
    const user = await this.prisma.user.findUnique({ where: { id: attempt.offer.technicianId }, select: { locale: true } });
    return { attempt, offer: attempt.offer, locale: user?.locale ?? 'en' };
  }

  /** Ends an open phone offer (EXPIRED or WITHDRAWN), counts a miss when asked, and offers the next technician. */
  private async endOffer(offerId: string, state: 'EXPIRED' | 'WITHDRAWN', countMiss: boolean): Promise<void> {
    const offer = await this.prisma.jobOffer.findUnique({ where: { id: offerId } });
    if (!offer) return;
    const ended = await this.prisma.$transaction(async (tx) => {
      await this.core.lock(tx, offer.bookingId);
      const now = new Date(this.clock.now());
      const r = await tx.jobOffer.updateMany({ where: { id: offerId, state: 'OPEN' }, data: { state, respondedAt: now } });
      if (r.count === 0) return false;
      if (countMiss) {
        const tech = await tx.technician.update({ where: { userId: offer.technicianId }, data: { missedOffersInRow: { increment: 1 } } });
        if (tech.missedOffersInRow >= MISSED_OFFERS_LIMIT && tech.online) {
          await tx.technician.update({ where: { userId: offer.technicianId }, data: { online: false, missedOffersInRow: 0, availabilitySource: 'SYSTEM' } });
          await this.audit.record({ actorType: 'SYSTEM', actorId: null, action: 'tech.set_offline', entity: 'technician', entityId: offer.technicianId, before: { online: true }, after: { online: false, reason: `missed ${MISSED_OFFERS_LIMIT} phone offers` } }, tx);
        }
      }
      return true;
    });
    if (ended) await this.dispatch.offerNext(offer.bookingId);
  }

  private async ownTechnician(coordinatorId: string, technicianId: string) {
    if (!UUID.test(technicianId)) throw new AppError('NOT_FOUND');
    const t = await this.prisma.technician.findFirst({ where: { userId: technicianId, coordinatorId } });
    if (!t) throw new AppError('NOT_FOUND', {}, 'not one of your technicians');
    return t;
  }

  private pinHash(technicianId: string, pin: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(createHmac('sha256', Buffer.from(this.config.OTP_PEPPER_B64 ?? '', 'base64')).update(`ivr-pin:v1:${technicianId}:${pin}`).digest());
  }

  private pinMatches(technicianId: string, pin: string, stored: Uint8Array): boolean {
    const a = Buffer.from(this.pinHash(technicianId, pin));
    const b = Buffer.from(stored);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Callback URLs carry the webhook secret, so only the provider (who was given them) can call. */
  callbackUrl(step: 'status' | 'prompt' | 'choice' | 'pin' | 'connect' | 'availability'): string {
    return `${this.config.PUBLIC_BASE_URL}/v1/webhooks/telephony/exotel/${this.config.EXOTEL_WEBHOOK_SECRET ?? 'unset'}/${step}`;
  }
}
