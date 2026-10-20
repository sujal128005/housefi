import { Injectable, Logger } from '@nestjs/common';
import type { Booking, BookingStatus, CategoryId, OfferRejectReason, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingCore, SYSTEM, UUID } from '../bookings/booking-core';
import { TECH_ACTIVE } from '../bookings/booking-status';
import type { JobDto } from '../bookings/job-view';
import { Notifier } from '../notifications/notifier';
import { istDate, istDayStart, istHour as istHourOf, windowStartMs } from '../slots/slot-rules';
import { type JobOfferDto, toJobOfferDto } from './offer-view';
import { bookingEstimate, PREP_MIN, travelMinutes } from './travel-time';

/** Offers not answered this many times in a row take the technician offline (README §4). */
export const MISSED_OFFERS_LIMIT = 3;
/** Instant visit: reassigned if the trip has not started this long after accepting. */
export const INSTANT_START_WITHIN_MIN = 10;
/** Scheduled visit: reassigned if the trip has not started by this long before the window. */
export const SCHEDULED_START_BEFORE_MIN = 30;

/**
 * Trades whose technicians also get each other's jobs (the same tools and know-how): an electrician gets AC and
 * appliance jobs too, and so on. Plumbing, carpentry and cleaning go only to technicians who chose that trade.
 */
export const SHARED_TRADES: readonly CategoryId[] = ['ELECTRICAL', 'AC', 'APPLIANCE'];

/** The skills that qualify a technician for a job in this category. */
export function skillsFor(category: CategoryId): CategoryId[] {
  return SHARED_TRADES.includes(category) ? [...SHARED_TRADES] : [category];
}

const SEARCHING: readonly BookingStatus[] = ['MATCHING', 'MATCHING_DELAYED'];
const BATCH = 100;

/**
 * Phone offers for keypad-phone technicians, provided by the telephony module when calls are switched on
 * (TELEPHONY_PROVIDER). Kept as a hook so dispatch does not depend on telephony (no module cycle).
 */
export interface PhoneOffers {
  /** Calls can be placed right now (provider configured, circuit breaker closed). */
  available(): boolean;
  /** Places the call for a new IVR offer (after its transaction committed). Never throws. */
  place(offerId: string): Promise<void>;
}

export interface TickResult {
  readonly expired: number;
  readonly delayed: number;
  readonly unfulfilled: number;
  readonly reassigned: number;
  readonly offered: number;
}

/**
 * Sequential dispatch (README §4, STATE-MACHINE.md): one technician at a time, 45 s each, best candidate first.
 * Every step locks the booking row first, so offers, answers, timeouts and customer actions never race. Timers are a
 * 5-second sweep (DispatchWorker) plus exact checks on every answer, so nothing depends on Redis or survives only
 * in memory.
 */
@Injectable()
export class DispatchService {
  private readonly log = new Logger(DispatchService.name);

  private phone: PhoneOffers | null = null;

  /** Called by the telephony module at start-up. */
  usePhoneOffers(phone: PhoneOffers): void {
    this.phone = phone;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: BookingCore,
    private readonly notifier: Notifier,
    private readonly audit: AuditService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  // ---------- offering ----------

  /**
   * Offers a searching booking to the best free technician, unless an offer is already open. Never throws: a failure
   * is logged and the worker tries again within seconds. Call after the transaction that started the search commits.
   */
  async offerNext(bookingId: string): Promise<boolean> {
    try {
      const offered = await this.prisma.$transaction(async (tx) => {
        const b = await this.core.lock(tx, bookingId);
        if (!b || !SEARCHING.includes(b.status)) return false;
        if (await tx.jobOffer.findFirst({ where: { bookingId, state: 'OPEN' }, select: { id: true } })) return false;
        const candidate = await this.bestCandidate(tx, b);
        if (!candidate) {
          // Nobody reachable by app or phone call: a coordinator may still reach technicians without a phone.
          await this.queueIfPeopleCanHelp(tx, b);
          return false;
        }
        const now = this.clock.now();
        const byPhone = candidate.phone_type === 'KEYPAD';
        // A phone offer covers ringing plus the spoken offer (IVR_OFFER_TIMEOUT_SEC, about 90 s).
        const expiresAt = now + (byPhone ? this.config.IVR_OFFER_TIMEOUT_SEC : this.config.OFFER_TIMEOUT_SEC) * 1000;
        const offer = await tx.jobOffer.create({
          data: { bookingId, technicianId: candidate.id, channel: byPhone ? 'IVR' : 'APP', distanceM: candidate.distance_m, createdAt: new Date(now), expiresAt: new Date(expiresAt) },
        });
        if (byPhone) return { phoneOfferId: offer.id };
        // High priority with sound, dropped by the push service once the offer has expired (notifications.service.ts).
        await this.notifier.enqueue(tx, [
          {
            userId: candidate.id,
            kind: 'JOB_OFFER',
            bookingId,
            params: { code: b.code, offerId: offer.id, serviceId: b.serviceId, earning: this.config.TECH_VISIT_SHARE_RUPEES, expiresAt },
          },
        ]);
        return { phoneOfferId: null };
      });
      if (offered && typeof offered === 'object' && offered.phoneOfferId && this.phone) await this.phone.place(offered.phoneOfferId);
      return offered !== false;
    } catch (err) {
      this.log.warn(`offer for booking ${bookingId} failed (${(err as Error).message}); retrying on the next sweep`);
      return false;
    }
  }

  /**
   * The best free technician for a booking, locked for this transaction (rows another dispatch is using are skipped,
   * so two bookings never pick the same technician at once). Order: women-rated first when the customer asked, then
   * distance, rating and fewest jobs accepted today (fairness).
   */
  private async bestCandidate(tx: Prisma.TransactionClient, b: Booking): Promise<{ id: string; distance_m: number | null; phone_type: string } | null> {
    const dayStart = new Date(istDayStart(this.clock.now()));
    // Keypad-phone technicians are offered by phone call only when calls work right now, they agreed to job calls and
    // set a PIN, and it is within their calling hours (IST). Technicians without a phone go through their coordinator.
    const phoneOk = this.phone?.available() ?? false;
    const hour = istHourOf(this.clock.now());
    const radiusM = this.config.DISPATCH_RADIUS_KM * 1000;
    const rows = await tx.$queryRaw<{ id: string; distance_m: number | null; phone_type: string }[]>`
      SELECT t.user_id::text AS id, t.phone_type::text AS phone_type,
        CASE WHEN t.last_location IS NOT NULL AND b.location IS NOT NULL THEN ST_Distance(t.last_location, b.location)::int END AS distance_m
      FROM technicians t
      JOIN bookings b ON b.id = ${b.id}::uuid
      JOIN users u ON u.id = t.user_id
      WHERE t.verification = 'APPROVED' AND t.online AND u.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM technician_skills s WHERE s.technician_id = t.user_id AND s.category_id = ANY(${skillsFor(b.categoryId)}::category_id[]))
        -- Demo bookings go only to the team's demo technicians, real bookings only to real technicians.
        AND u.is_demo = b.is_demo
        AND (t.phone_type = 'SMARTPHONE' OR (
          ${phoneOk} AND t.phone_type = 'KEYPAD' AND t.ivr_pin_hash IS NOT NULL AND t.ivr_consent_at IS NOT NULL
          AND COALESCE(t.call_hours_start, 8) <= ${hour} AND ${hour} < COALESCE(t.call_hours_end, 20)
        ))
        -- The area: the same PIN, a neighbouring PIN, or (while online, the app shares where they are) within
        -- DISPATCH_RADIUS_KM of the customer, so a PIN boundary between two streets does not hide a nearby technician.
        -- (The technician the customer asked for again has worked at this customer's place already: any area.)
        AND (t.user_id = b.preferred_technician_id
          OR t.pincode = b.pincode OR t.pincode IN (SELECT a.near_pincode FROM service_area_pincodes a WHERE a.pincode = b.pincode)
          OR (${radiusM} > 0 AND t.last_location IS NOT NULL AND b.location IS NOT NULL AND ST_DWithin(t.last_location, b.location, ${radiusM})))
        AND NOT EXISTS (SELECT 1 FROM bookings busy WHERE busy.technician_id = t.user_id AND busy.status = ANY(${[...TECH_ACTIVE]}::booking_status[]))
        AND NOT EXISTS (SELECT 1 FROM job_offers o WHERE o.technician_id = t.user_id AND o.state = 'OPEN')
        AND NOT EXISTS (SELECT 1 FROM job_offers o WHERE o.booking_id = b.id AND o.technician_id = t.user_id)
      ORDER BY
        -- "Book the same technician again": asked first; if they decline or miss it, the search goes on as usual.
        CASE WHEN t.user_id = b.preferred_technician_id THEN 0 ELSE 1 END,
        CASE WHEN b.prefer_women_rated AND t.women_rated THEN 0 ELSE 1 END,
        distance_m ASC NULLS LAST,
        t.rating_avg DESC NULLS LAST,
        (SELECT count(*) FROM job_offers j WHERE j.technician_id = t.user_id AND j.state = 'ACCEPTED' AND j.responded_at >= ${dayStart}) ASC,
        t.user_id
      LIMIT 1
      FOR UPDATE OF t SKIP LOCKED`;
    return rows[0] ?? null;
  }

  /**
   * The manual queue: a booking nobody could be offered to goes to coordinators when one of their technicians could
   * do it (approved, the skill, the area, free) but is reachable only by a person (no phone, or calls unavailable).
   */
  private async queueIfPeopleCanHelp(tx: Prisma.TransactionClient, b: Booking): Promise<void> {
    const [row] = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM technicians t
      JOIN users u ON u.id = t.user_id
      WHERE t.verification = 'APPROVED' AND t.coordinator_id IS NOT NULL AND t.phone_type <> 'SMARTPHONE'
        AND EXISTS (SELECT 1 FROM technician_skills s WHERE s.technician_id = t.user_id AND s.category_id = ANY(${skillsFor(b.categoryId)}::category_id[]))
        AND u.status = 'ACTIVE' AND u.is_demo = ${b.isDemo}
        AND (t.pincode = ${b.pincode} OR t.pincode IN (SELECT a.near_pincode FROM service_area_pincodes a WHERE a.pincode = ${b.pincode}))
        AND NOT EXISTS (SELECT 1 FROM bookings busy WHERE busy.technician_id = t.user_id AND busy.status = ANY(${[...TECH_ACTIVE]}::booking_status[]))`;
    if (Number(row?.n ?? 0) > 0) await this.enqueue(tx, b.id, 'no app or phone technician available; a coordinator can call theirs');
  }

  /** Puts a booking in the coordinators' queue (once; a resolved entry is reopened). */
  async enqueue(tx: Prisma.TransactionClient, bookingId: string, reason: string): Promise<void> {
    const now = new Date(this.clock.now());
    await tx.$executeRaw`
      INSERT INTO dispatch_queue (booking_id, reason, entered_at) VALUES (${bookingId}::uuid, ${reason}, ${now})
      ON CONFLICT (booking_id) DO UPDATE SET reason = EXCLUDED.reason, entered_at = EXCLUDED.entered_at, claimed_by = NULL, claimed_at = NULL, resolved_at = NULL
      WHERE dispatch_queue.resolved_at IS NOT NULL`;
  }

  /** Inside the caller's transaction: closes the booking's open offer (customer cancelled, rescheduled, gave up). */
  async withdrawOpen(tx: Prisma.TransactionClient, bookingId: string): Promise<void> {
    await tx.jobOffer.updateMany({ where: { bookingId, state: 'OPEN' }, data: { state: 'WITHDRAWN', respondedAt: new Date(this.clock.now()) } });
  }

  // ---------- technician ----------

  /** The technician's open offer, or null. An offer past its 45 s is never shown, even before the sweep closes it. */
  async currentOffer(technicianId: string): Promise<JobOfferDto | null> {
    const offer = await this.prisma.jobOffer.findFirst({
      where: { technicianId, state: 'OPEN', expiresAt: { gt: new Date(this.clock.now()) } },
      include: { booking: { include: { _count: { select: { uploads: { where: { kind: 'PHOTO', stage: 'PROBLEM' } } } } } } },
    });
    return offer ? toJobOfferDto(offer, this.config.TECH_VISIT_SHARE_RUPEES) : null;
  }

  /**
   * Accepts in one transaction with the booking, offer and technician rows locked: the offer must still be open and
   * within its time, the booking still searching, the technician approved and free. Otherwise OFFER_EXPIRED (410).
   * The app's Accept and a keypad accept on a phone call both come here, so exactly one acceptance can ever win.
   */
  async accept(technicianId: string, offerId: string): Promise<JobDto> {
    const offer0 = await this.ownOffer(technicianId, offerId);
    await this.acceptInTx(technicianId, offerId, offer0.bookingId, 'APP');
    this.core.updates.publish(offer0.bookingId);
    return this.core.getJob(technicianId, offer0.bookingId);
  }

  /** A keypad accept on an answered offer call (after the PIN). False when the job is no longer available. */
  async acceptByPhone(technicianId: string, offerId: string): Promise<boolean> {
    const offer0 = await this.prisma.jobOffer.findUnique({ where: { id: offerId } });
    if (!offer0 || offer0.technicianId !== technicianId || offer0.channel !== 'IVR') return false;
    try {
      await this.acceptInTx(technicianId, offerId, offer0.bookingId, 'IVR');
    } catch (err) {
      if (err instanceof AppError && err.code === 'OFFER_EXPIRED') return false;
      throw err;
    }
    this.core.updates.publish(offer0.bookingId);
    return true;
  }

  private async acceptInTx(technicianId: string, offerId: string, bookingId: string, via: 'APP' | 'IVR'): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const b = await this.core.lock(tx, bookingId);
      await tx.$queryRaw`SELECT user_id FROM technicians WHERE user_id = ${technicianId}::uuid FOR UPDATE`;
      const offer = await tx.jobOffer.findUniqueOrThrow({ where: { id: offerId } });
      const tech = await tx.technician.findUnique({ where: { userId: technicianId }, select: { verification: true } });
      const now = new Date(this.clock.now());
      const busy = await tx.booking.count({ where: { technicianId, status: { in: [...TECH_ACTIVE] } } });
      if (offer.state !== 'OPEN' || offer.expiresAt <= now || !b || !SEARCHING.includes(b.status) || tech?.verification !== 'APPROVED' || busy > 0) {
        throw new AppError('OFFER_EXPIRED');
      }
      await tx.jobOffer.update({ where: { id: offerId }, data: { state: 'ACCEPTED', respondedAt: now } });
      // An instant visit shows when the technician should arrive straight away: getting ready plus the trip.
      const metres = b.timeMode === 'INSTANT' ? await this.distanceM(tx, technicianId, bookingId) : null;
      const etaMin = metres === null ? null : PREP_MIN + travelMinutes(metres, now.getTime());
      await this.core.transition(tx, b, 'ASSIGNED', { technician: { connect: { userId: technicianId } }, assignedAt: now, etaMin }, { type: 'TECHNICIAN', id: technicianId }, { offerId, ...(via === 'IVR' ? { via: 'IVR' } : {}) });
      await tx.technician.update({ where: { userId: technicianId }, data: { missedOffersInRow: 0 } });
      await tx.dispatchQueueEntry.updateMany({ where: { bookingId, resolvedAt: null }, data: { resolvedAt: now } });
    });
  }

  /** Straight-line metres from the technician's last position to the booking; null when either is unknown. */
  private async distanceM(tx: Prisma.TransactionClient, technicianId: string, bookingId: string): Promise<number | null> {
    const [row] = await tx.$queryRaw<{ m: number | null }[]>`
      SELECT ST_Distance(t.last_location, b.location) AS m FROM technicians t, bookings b
      WHERE t.user_id = ${technicianId}::uuid AND b.id = ${bookingId}::uuid`;
    return row?.m ?? null;
  }

  /**
   * Before booking "Now": roughly when a technician could be at this address ("25–35 min"), from the nearest one who
   * could take it right now (the same rules as an offer). Only minutes come back, never where anyone is; null when
   * nobody is free nearby or the address has no map point (the app then shows its usual range).
   */
  async estimate(customerId: string, serviceId: string, addressId: string): Promise<{ minutes: readonly [number, number] | null }> {
    if (!UUID.test(addressId)) throw new AppError('NOT_FOUND');
    const service = await this.prisma.service.findFirst({ where: { id: serviceId, active: true }, select: { categoryId: true } });
    const address = await this.prisma.address.findFirst({ where: { id: addressId, userId: customerId }, select: { id: true } });
    if (!service || !address) throw new AppError('NOT_FOUND');
    const isDemo = (await this.prisma.user.findUnique({ where: { id: customerId }, select: { isDemo: true } }))?.isDemo ?? false;
    const radiusM = this.config.DISPATCH_RADIUS_KM * 1000;
    const [row] = await this.prisma.$queryRaw<{ m: number | null }[]>`
      SELECT MIN(ST_Distance(t.last_location, a.location)) AS m
      FROM technicians t JOIN users u ON u.id = t.user_id, addresses a
      WHERE a.id = ${addressId}::uuid AND a.location IS NOT NULL AND t.last_location IS NOT NULL
        AND t.verification = 'APPROVED' AND t.online AND u.status = 'ACTIVE' AND u.is_demo = ${isDemo} AND t.phone_type = 'SMARTPHONE'
        AND EXISTS (SELECT 1 FROM technician_skills s WHERE s.technician_id = t.user_id AND s.category_id = ANY(${skillsFor(service.categoryId)}::category_id[]))
        AND (t.pincode = a.pincode OR t.pincode IN (SELECT n.near_pincode FROM service_area_pincodes n WHERE n.pincode = a.pincode)
          OR (${radiusM} > 0 AND ST_DWithin(t.last_location, a.location, ${radiusM})))
        AND NOT EXISTS (SELECT 1 FROM bookings busy WHERE busy.technician_id = t.user_id AND busy.status = ANY(${[...TECH_ACTIVE]}::booking_status[]))`;
    return { minutes: row?.m === null || row?.m === undefined ? null : bookingEstimate(row.m, this.clock.now()) };
  }

  /** Declines (optional reason); the next technician is offered at once. Answering an offer that is no longer open is a no-op. */
  async reject(technicianId: string, offerId: string, reason: OfferRejectReason | null): Promise<void> {
    const offer0 = await this.ownOffer(technicianId, offerId);
    const changed = await this.prisma.$transaction(async (tx) => {
      await this.core.lock(tx, offer0.bookingId);
      const offer = await tx.jobOffer.findUniqueOrThrow({ where: { id: offerId } });
      if (offer.state !== 'OPEN') return false;
      await tx.jobOffer.update({ where: { id: offerId }, data: { state: 'REJECTED', rejectReason: reason, respondedAt: new Date(this.clock.now()) } });
      // An answer is not a miss.
      await tx.technician.update({ where: { userId: technicianId }, data: { missedOffersInRow: 0 } });
      return true;
    });
    if (changed) await this.offerNext(offer0.bookingId);
  }

  // ---------- timers (DispatchWorker) ----------

  async tick(): Promise<TickResult> {
    const expired = await this.expireOffers();
    const { delayed, unfulfilled } = await this.escalate();
    const reassigned = await this.reassignLate();
    const offered = await this.offerUnoffered();
    await this.closeQueueEntries();
    return { expired, delayed, unfulfilled, reassigned, offered };
  }

  /** Queue entries whose booking was assigned, cancelled or given up on are resolved. */
  async closeQueueEntries(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE dispatch_queue q SET resolved_at = ${new Date(this.clock.now())}
      FROM bookings b WHERE b.id = q.booking_id AND q.resolved_at IS NULL AND b.status NOT IN ('MATCHING', 'MATCHING_DELAYED')`;
  }

  /** Offers past 45 s: EXPIRED, counted as a miss (3 in a row: offline), and the next technician is offered. */
  async expireOffers(): Promise<number> {
    const now = new Date(this.clock.now());
    const due = await this.prisma.jobOffer.findMany({ where: { state: 'OPEN', expiresAt: { lte: now } }, select: { id: true, bookingId: true }, take: BATCH });
    let n = 0;
    for (const o of due) {
      const expired = await this.prisma.$transaction(async (tx) => {
        await this.core.lock(tx, o.bookingId);
        const offer = await tx.jobOffer.findUniqueOrThrow({ where: { id: o.id } });
        if (offer.state !== 'OPEN' || offer.expiresAt > now) return false;
        await tx.jobOffer.update({ where: { id: o.id }, data: { state: 'EXPIRED' } });
        const tech = await tx.technician.update({ where: { userId: offer.technicianId }, data: { missedOffersInRow: { increment: 1 } } });
        if (tech.missedOffersInRow >= MISSED_OFFERS_LIMIT && tech.online) {
          await tx.technician.update({ where: { userId: offer.technicianId }, data: { online: false, missedOffersInRow: 0 } });
          await tx.$executeRaw`UPDATE technicians SET last_location = NULL, last_location_at = NULL, last_accuracy_m = NULL WHERE user_id = ${offer.technicianId}::uuid`;
          this.log.log(`technician ${offer.technicianId} missed ${MISSED_OFFERS_LIMIT} offers in a row; set offline`);
          await this.audit.record({ actorType: 'SYSTEM', actorId: null, action: 'tech.set_offline', entity: 'technician', entityId: offer.technicianId, before: { online: true }, after: { online: false, reason: `missed ${MISSED_OFFERS_LIMIT} offers` } }, tx);
          // No NotificationKind for this yet (QUESTIONS.md #48); the app sees online: false in GET /tech/me.
        }
        return true;
      });
      if (expired) {
        n++;
        await this.offerNext(o.bookingId);
      }
    }
    return n;
  }

  /** ~10 min searching: MATCHING_DELAYED (still searching). ~30 min: UNFULFILLED, and the open offer is withdrawn. */
  async escalate(): Promise<{ delayed: number; unfulfilled: number }> {
    const now = this.clock.now();
    const delayAt = new Date(now - this.config.MATCHING_DELAYED_AFTER_MIN * 60_000);
    const giveUpAt = new Date(now - this.config.MATCHING_GIVE_UP_AFTER_MIN * 60_000);
    const due = await this.prisma.booking.findMany({
      where: { OR: [{ status: 'MATCHING', matchingStartedAt: { lte: delayAt } }, { status: 'MATCHING_DELAYED', matchingStartedAt: { lte: giveUpAt } }] },
      select: { id: true },
      take: BATCH,
    });
    let delayed = 0;
    let unfulfilled = 0;
    for (const { id } of due) {
      const result = await this.prisma.$transaction(async (tx) => {
        let b = await this.core.lock(tx, id);
        if (!b?.matchingStartedAt || !SEARCHING.includes(b.status)) return null;
        let wasDelayed = false;
        if (b.status === 'MATCHING' && b.matchingStartedAt <= delayAt) {
          await this.core.transition(tx, b, 'MATCHING_DELAYED', {}, SYSTEM, { minutes: this.config.MATCHING_DELAYED_AFTER_MIN });
          // Still nobody after ~10 minutes: a coordinator looks at it too.
          await this.enqueue(tx, id, `no technician accepted within ${this.config.MATCHING_DELAYED_AFTER_MIN} minutes`);
          b = (await tx.booking.findUniqueOrThrow({ where: { id } })) as Booking;
          wasDelayed = true;
        }
        if (b.status === 'MATCHING_DELAYED' && b.matchingStartedAt && b.matchingStartedAt <= giveUpAt) {
          await this.withdrawOpen(tx, id);
          await this.core.transition(tx, b, 'UNFULFILLED', {}, SYSTEM, { minutes: this.config.MATCHING_GIVE_UP_AFTER_MIN });
          return { wasDelayed, gaveUp: true };
        }
        return { wasDelayed, gaveUp: false };
      });
      if (!result) continue;
      if (result.wasDelayed) delayed++;
      if (result.gaveUp) unfulfilled++;
      this.core.updates.publish(id);
    }
    return { delayed, unfulfilled };
  }

  /**
   * Assigned but the trip has not started in time (instant: 10 min after accepting; scheduled: 30 min before the
   * window): back to MATCHING with a fresh 30-minute search; that technician is not offered this booking again.
   */
  async reassignLate(): Promise<number> {
    const now = this.clock.now();
    const instantLate = new Date(now - INSTANT_START_WITHIN_MIN * 60_000);
    const candidates = await this.prisma.booking.findMany({
      where: {
        status: 'ASSIGNED',
        OR: [
          { timeMode: 'INSTANT', assignedAt: { lte: instantLate } },
          // Coarse filter; the exact window check is below.
          { timeMode: 'SCHEDULED', windowDate: { lte: new Date(`${istDate(now + SCHEDULED_START_BEFORE_MIN * 60_000)}T00:00:00Z`) } },
        ],
      },
      take: BATCH,
    });
    const late = (b: Booking) =>
      b.timeMode === 'INSTANT'
        ? !!b.assignedAt && b.assignedAt <= instantLate
        : !!b.windowDate && b.windowStartHour !== null && windowStartMs(b.windowDate.toISOString().slice(0, 10), b.windowStartHour) - SCHEDULED_START_BEFORE_MIN * 60_000 <= now;
    let n = 0;
    for (const c of candidates.filter(late)) {
      const done = await this.prisma.$transaction(async (tx) => {
        const b = await this.core.lock(tx, c.id);
        if (!b || b.status !== 'ASSIGNED' || !late(b)) return false;
        await this.core.transition(
          tx,
          b,
          'MATCHING',
          { technician: { disconnect: true }, assignedAt: null, matchingStartedAt: new Date(now) },
          SYSTEM,
          { reassigned: true, previousTechnicianId: b.technicianId },
        );
        return true;
      });
      if (done) {
        n++;
        this.core.updates.publish(c.id);
        await this.offerNext(c.id);
      }
    }
    return n;
  }

  /** Searching bookings without an open offer (nobody was free, a technician declined or went offline): try again. */
  async offerUnoffered(): Promise<number> {
    const due = await this.prisma.booking.findMany({
      where: { status: { in: [...SEARCHING] }, offers: { none: { state: 'OPEN' } } },
      orderBy: { matchingStartedAt: 'asc' },
      select: { id: true },
      take: BATCH,
    });
    let n = 0;
    for (const b of due) if (await this.offerNext(b.id)) n++;
    return n;
  }

  // ---------- internals ----------

  private async ownOffer(technicianId: string, offerId: string) {
    const offer = UUID.test(offerId) ? await this.prisma.jobOffer.findUnique({ where: { id: offerId } }) : null;
    if (!offer || offer.technicianId !== technicianId) throw new AppError('NOT_FOUND');
    return offer;
  }
}
