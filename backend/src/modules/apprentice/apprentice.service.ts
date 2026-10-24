// Apprentice mode: a technician still learning a trade (identity checked, trade not passed yet) learns on real jobs
// with an experienced technician (the mentor). The apprentice asks a mentor in their trade and city; the mentor
// accepts; the mentor brings the apprentice on jobs whose customer agreed to a trainee; after the job the mentor says
// whether they helped, and Housefi pays the apprentice APPRENTICE_SHARE_RUPEES from its own part (the customer pays the
// same; the technician's earnings do not change). The team's demo accounts only meet each other.
import { Injectable } from '@nestjs/common';
import { type CategoryId, Prisma, type Technician, type TechnicianSkill, type User } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { MediaUrls } from '../../common/storage/object-store';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { AddressDto } from '../addresses/addresses.service';
import { BookingCore } from '../bookings/booking-core';
import { ACTIVE_STATUSES } from '../bookings/booking-status';
import type { BookingDto } from '../bookings/booking-view';
import type { JobDto } from '../bookings/job-view';
import { displayName } from '../identity/identity-codes';
import { Notifier } from '../notifications/notifier';
import { CATEGORY_ORDER } from '../technicians/technicians.schemas';
import { learner, type LearnerBlock, mentorTrades, mentorWhere, TRAINEE_CHANGEABLE, TRAINEE_DECLINABLE } from './apprentice-rules';

type TechRow = Technician & { user: User; skills: TechnicianSkill[] };

/** openapi.yaml ApprenticePerson: the other side of an apprenticeship. */
export interface ApprenticePersonDto {
  readonly id: string;
  /** First name and last initial. */
  readonly name: string;
  readonly photo: string | null;
  readonly techCode: string;
  readonly rating: number | null;
  readonly jobsDone: number;
  readonly level: Technician['skillLevel'];
  /** Only once the apprenticeship is active (they work together). */
  readonly phone: string | null;
}

/** openapi.yaml ApprenticeLink. */
export interface ApprenticeLinkDto {
  readonly id: string;
  readonly categoryId: CategoryId;
  readonly state: 'REQUESTED' | 'ACTIVE' | 'DECLINED' | 'ENDED';
  readonly at: number;
  readonly other: ApprenticePersonDto;
}

/** openapi.yaml TraineeJob: a job the apprentice joins (the address only while it is on). */
export interface TraineeJobDto {
  readonly id: string;
  readonly code: string;
  readonly serviceId: string;
  readonly categoryId: CategoryId;
  readonly status: string;
  readonly time: { readonly mode: 'INSTANT' | 'SCHEDULED'; readonly window: { date: string; startHour: number; endHour: number } | null };
  readonly address: AddressDto | null;
  readonly mentor: { readonly name: string; readonly phone: string };
  readonly helped: boolean | null;
  /** Rupees credited for this job (0 until the mentor says they helped). */
  readonly earning: number;
}

/** openapi.yaml ApprenticeOverview. */
export interface ApprenticeOverviewDto {
  readonly shareRupees: number;
  readonly jobsTarget: number;
  readonly learner: {
    readonly eligible: boolean;
    readonly block: LearnerBlock | null;
    readonly trades: readonly CategoryId[];
    /** The latest apprenticeship asked for (any state; a declined or ended one means: choose a mentor again). */
    readonly link: ApprenticeLinkDto | null;
    readonly helped: readonly { readonly categoryId: CategoryId; readonly jobs: number }[];
    readonly jobs: readonly TraineeJobDto[];
  };
  readonly mentor: {
    readonly trades: readonly CategoryId[];
    readonly open: boolean;
    readonly max: number;
    readonly requests: readonly ApprenticeLinkDto[];
    readonly apprentices: readonly ApprenticeLinkDto[];
  };
}

const OPEN = ['REQUESTED', 'ACTIVE'] as const;
const TRAINEE_JOBS_SHOWN = 20;
/** Like the technician's own job (job-view.ts): the address goes away a day after the job closes. */
const ADDRESS_AFTER_CLOSE_MS = 24 * 60 * 60_000;
const sortTrades = (ids: CategoryId[]) => ids.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));

@Injectable()
export class ApprenticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly media: MediaUrls,
    private readonly core: BookingCore,
    private readonly notifier: Notifier,
    private readonly audit: AuditService,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  // ---------- reads ----------

  async overview(technicianId: string): Promise<ApprenticeOverviewDto> {
    const me = await this.tech(technicianId);
    const asLearner = learner(me);
    const [latest, helped, trainee, mentorLinks] = await Promise.all([
      this.prisma.apprenticeLink.findFirst({ where: { apprenticeId: me.userId }, orderBy: { createdAt: 'desc' }, include: { mentor: { include: { user: true } } } }),
      this.prisma.booking.groupBy({ by: ['categoryId'], where: { traineeId: me.userId, traineeHelped: true }, _count: { _all: true } }),
      this.prisma.booking.findMany({
        where: { traineeId: me.userId },
        orderBy: { createdAt: 'desc' },
        take: TRAINEE_JOBS_SHOWN,
        include: { technician: { include: { user: true } }, events: { orderBy: { at: 'desc' }, take: 1 } },
      }),
      this.prisma.apprenticeLink.findMany({ where: { mentorId: me.userId, state: { in: [...OPEN] } }, orderBy: { createdAt: 'asc' }, include: { apprentice: { include: { user: true } } } }),
    ]);
    return {
      shareRupees: this.config.APPRENTICE_SHARE_RUPEES,
      jobsTarget: this.config.APPRENTICE_JOBS_TARGET,
      learner: {
        ...asLearner,
        trades: sortTrades(asLearner.trades),
        link: latest ? await this.linkDto(latest, latest.mentor) : null,
        helped: sortTrades(helped.map((h) => h.categoryId)).map((c) => ({ categoryId: c, jobs: helped.find((h) => h.categoryId === c)!._count._all })),
        jobs: await Promise.all(trainee.filter((b) => b.technician).map((b) => this.traineeJob(b, b.technician!))),
      },
      mentor: {
        trades: sortTrades(mentorTrades(me)),
        open: me.mentorOpen,
        max: this.config.MENTOR_MAX_APPRENTICES,
        requests: await Promise.all(mentorLinks.filter((l) => l.state === 'REQUESTED').map((l) => this.linkDto(l, l.apprentice))),
        apprentices: await Promise.all(mentorLinks.filter((l) => l.state === 'ACTIVE').map((l) => this.linkDto(l, l.apprentice))),
      },
    };
  }

  /** Mentors an apprentice can ask for a trade: open to teaching, qualified, in the same district, with room. */
  async mentors(technicianId: string, categoryId: CategoryId): Promise<ApprenticePersonDto[]> {
    const me = await this.tech(technicianId);
    const rows = await this.prisma.technician.findMany({
      where: { ...mentorWhere(categoryId), userId: { not: me.userId }, city: me.city, user: { isDemo: me.user.isDemo } },
      include: { user: true, _count: { select: { mentorLinks: { where: { state: 'ACTIVE' } } } } },
      orderBy: [{ ratingAvg: { sort: 'desc', nulls: 'last' } }, { jobsDone: 'desc' }],
      take: 40,
    });
    const room = rows.filter((r) => r._count.mentorLinks < this.config.MENTOR_MAX_APPRENTICES).slice(0, 20);
    return Promise.all(room.map((r) => this.person(r, false)));
  }

  // ---------- the apprentice ----------

  async request(technicianId: string, mentorId: string, categoryId: CategoryId): Promise<ApprenticeOverviewDto> {
    const me = await this.tech(technicianId);
    const asLearner = learner(me);
    if (!asLearner.eligible) throw new AppError('CONFLICT', {}, `cannot learn on the job yet (${asLearner.block})`);
    if (!asLearner.trades.includes(categoryId)) throw new AppError('VALIDATION', { fields: { categoryId: 'INVALID' } });
    const mentor = await this.prisma.technician.findFirst({
      where: { ...mentorWhere(categoryId), userId: mentorId, city: me.city, user: { isDemo: me.user.isDemo } },
      include: { user: true, _count: { select: { mentorLinks: { where: { state: 'ACTIVE' } } } } },
    });
    if (!mentor || mentor.userId === me.userId) throw new AppError('NOT_FOUND');
    if (mentor._count.mentorLinks >= this.config.MENTOR_MAX_APPRENTICES) throw new AppError('CONFLICT', {}, 'this mentor has no room');
    try {
      await this.prisma.$transaction(async (tx) => {
        const link = await tx.apprenticeLink.create({ data: { apprenticeId: me.userId, mentorId, categoryId, createdAt: new Date(this.clock.now()) } });
        await this.notifier.enqueue(tx, [{ userId: mentorId, kind: 'APPRENTICE_REQUEST', bookingId: null, params: { name: await this.shortName(me.user) } }]);
        await this.audit.record({ actorType: 'TECHNICIAN', actorId: me.userId, action: 'apprentice.requested', entity: 'apprentice_link', entityId: link.id, after: { mentorId, categoryId } }, tx);
      });
    } catch (err) {
      // One open request or apprenticeship at a time (a unique index).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new AppError('CONFLICT', {}, 'you already have a mentor or a request');
      throw err;
    }
    return this.overview(technicianId);
  }

  // ---------- the mentor ----------

  async setMentoring(technicianId: string, open: boolean): Promise<ApprenticeOverviewDto> {
    const me = await this.tech(technicianId);
    if (open && mentorTrades(me).length === 0) throw new AppError('CONFLICT', {}, 'not a mentor yet (a passed trade, skilled level and a good rating)');
    if (me.mentorOpen !== open) {
      await this.prisma.technician.update({ where: { userId: me.userId }, data: { mentorOpen: open } });
      await this.audit.record({ actorType: 'TECHNICIAN', actorId: me.userId, action: open ? 'apprentice.mentoring_on' : 'apprentice.mentoring_off', entity: 'technician', entityId: me.userId });
    }
    return this.overview(technicianId);
  }

  async answer(technicianId: string, linkId: string, accept: boolean): Promise<ApprenticeOverviewDto> {
    await this.prisma.$transaction(async (tx) => {
      const link = await tx.apprenticeLink.findFirst({ where: { id: linkId, mentorId: technicianId, state: 'REQUESTED' }, include: { mentor: { include: { user: true } } } });
      if (!link) throw new AppError('NOT_FOUND');
      if (accept) {
        const active = await tx.apprenticeLink.count({ where: { mentorId: technicianId, state: 'ACTIVE' } });
        if (active >= this.config.MENTOR_MAX_APPRENTICES) throw new AppError('CONFLICT', {}, 'you already teach the most apprentices');
      }
      await tx.apprenticeLink.update({ where: { id: link.id }, data: { state: accept ? 'ACTIVE' : 'DECLINED', respondedAt: new Date(this.clock.now()) } });
      if (accept) await this.notifier.enqueue(tx, [{ userId: link.apprenticeId, kind: 'APPRENTICE_ACCEPTED', bookingId: null, params: { name: await this.shortName(link.mentor.user) } }]);
      await this.audit.record({ actorType: 'TECHNICIAN', actorId: technicianId, action: accept ? 'apprentice.accepted' : 'apprentice.declined', entity: 'apprentice_link', entityId: link.id }, tx);
    });
    return this.overview(technicianId);
  }

  /** Either side ends an apprenticeship (or the apprentice takes back a request); upcoming jobs together end too. */
  async end(technicianId: string, linkId: string): Promise<ApprenticeOverviewDto> {
    await this.prisma.$transaction(async (tx) => {
      const link = await tx.apprenticeLink.findFirst({ where: { id: linkId, state: { in: [...OPEN] }, OR: [{ apprenticeId: technicianId }, { mentorId: technicianId }] } });
      if (!link) throw new AppError('NOT_FOUND');
      await tx.apprenticeLink.update({ where: { id: link.id }, data: { state: 'ENDED', endedAt: new Date(this.clock.now()) } });
      const upcoming = await tx.booking.findMany({ where: { traineeId: link.apprenticeId, technicianId: link.mentorId, status: { in: [...TRAINEE_CHANGEABLE] } }, select: { id: true, code: true } });
      for (const b of upcoming) await this.takeOff(tx, b, link.apprenticeId);
      await this.audit.record({ actorType: 'TECHNICIAN', actorId: technicianId, action: 'apprentice.ended', entity: 'apprentice_link', entityId: link.id }, tx);
    });
    return this.overview(technicianId);
  }

  // ---------- a trainee on a job ----------

  /** The mentor brings their apprentice (active, same trade) on a job whose customer agreed, before arriving. */
  async addTrainee(technicianId: string, jobId: string, apprenticeId: string): Promise<JobDto> {
    await this.core.mutateAssigned(technicianId, jobId, async (tx, b) => {
      if (!b.allowTrainee) throw new AppError('CONFLICT', {}, 'the customer did not agree to a trainee');
      if (!TRAINEE_CHANGEABLE.includes(b.status)) throw new AppError('CONFLICT', {}, 'only before you arrive');
      if (b.traineeId === apprenticeId) return { changed: false, result: undefined };
      if (b.traineeId) throw new AppError('CONFLICT', {}, 'a trainee is already on this job');
      const link = await tx.apprenticeLink.findFirst({
        where: { mentorId: technicianId, apprenticeId, categoryId: b.categoryId, state: 'ACTIVE' },
        include: { apprentice: { include: { user: true, skills: true } } },
      });
      if (!link || link.apprentice.user.isDemo !== b.isDemo || !learner(link.apprentice).eligible) throw new AppError('NOT_FOUND');
      await tx.booking.update({ where: { id: b.id }, data: { traineeId: apprenticeId, traineeAddedAt: new Date(this.clock.now()), traineeHelped: null, version: { increment: 1 } } });
      await this.notifier.enqueue(tx, [{ userId: apprenticeId, kind: 'TRAINEE_JOB', bookingId: b.id, params: { code: b.code } }]);
      await this.audit.record({ actorType: 'TECHNICIAN', actorId: technicianId, action: 'apprentice.trainee_added', entity: 'booking', entityId: b.id, after: { traineeId: apprenticeId } }, tx);
      return { changed: true, result: undefined };
    });
    return this.core.getJob(technicianId, jobId);
  }

  async removeTrainee(technicianId: string, jobId: string): Promise<JobDto> {
    await this.core.mutateAssigned(technicianId, jobId, async (tx, b) => {
      if (!b.traineeId) return { changed: false, result: undefined };
      if (!TRAINEE_CHANGEABLE.includes(b.status)) throw new AppError('CONFLICT', {}, 'only before you arrive');
      await this.takeOff(tx, b, b.traineeId);
      await this.audit.record({ actorType: 'TECHNICIAN', actorId: technicianId, action: 'apprentice.trainee_removed', entity: 'booking', entityId: b.id }, tx);
      return { changed: true, result: undefined };
    });
    return this.core.getJob(technicianId, jobId);
  }

  /** After the job: did the trainee come and help? Yes credits the apprentice share (once). */
  async confirmTrainee(technicianId: string, jobId: string, helped: boolean): Promise<JobDto> {
    await this.core.mutateAssigned(technicianId, jobId, async (tx, b) => {
      if (!b.traineeId) throw new AppError('NOT_FOUND');
      if (b.status !== 'COMPLETED' && b.status !== 'CLOSED_NO_REPAIR') throw new AppError('CONFLICT', {}, 'after the job');
      if (b.traineeHelped !== null) throw new AppError('CONFLICT', {}, 'already answered');
      const now = new Date(this.clock.now());
      await tx.booking.update({ where: { id: b.id }, data: { traineeHelped: helped, version: { increment: 1 } } });
      // Paid for a finished repair only (as the Fair-pay meter shows); a visit without a repair still counts as learning.
      const share = BigInt(this.config.APPRENTICE_SHARE_RUPEES) * 100n;
      if (helped && b.status === 'COMPLETED' && share > 0n) {
        await tx.earningsLedger.createMany({ data: [{ technicianId: b.traineeId, bookingId: b.id, type: 'APPRENTICE_SHARE', amountPaise: share, createdAt: now }], skipDuplicates: true });
      }
      await this.audit.record({ actorType: 'TECHNICIAN', actorId: technicianId, action: 'apprentice.trainee_confirmed', entity: 'booking', entityId: b.id, after: { helped } }, tx);
      return { changed: true, result: undefined };
    });
    return this.core.getJob(technicianId, jobId);
  }

  // ---------- the customer ----------

  /** "Not today": no trainee on this visit (until the technician arrives). */
  async decline(customerId: string, bookingId: string): Promise<BookingDto> {
    await this.core.mutateOwned(customerId, bookingId, async (tx, b) => {
      if (!b.allowTrainee && !b.traineeId) return { changed: false, result: undefined };
      if (!TRAINEE_DECLINABLE.includes(b.status)) throw new AppError('CONFLICT', {}, 'only before the technician arrives');
      if (b.traineeId) await this.takeOff(tx, b, b.traineeId);
      await tx.booking.update({ where: { id: b.id }, data: { allowTrainee: false, version: { increment: 1 } } });
      await this.audit.record({ actorType: 'CUSTOMER', actorId: customerId, action: 'apprentice.customer_declined', entity: 'booking', entityId: b.id }, tx);
      return { changed: true, result: undefined };
    });
    return this.core.get(customerId, bookingId);
  }

  // ---------- helpers ----------

  private async takeOff(tx: Prisma.TransactionClient, b: { id: string; code: string }, traineeId: string): Promise<void> {
    await tx.booking.update({ where: { id: b.id }, data: { traineeId: null, traineeAddedAt: null, version: { increment: 1 } } });
    await this.notifier.enqueue(tx, [{ userId: traineeId, kind: 'TRAINEE_REMOVED', bookingId: b.id, params: { code: b.code } }]);
  }

  private async tech(technicianId: string): Promise<TechRow & { mentorOpen: boolean }> {
    const t = await this.prisma.technician.findUnique({ where: { userId: technicianId }, include: { user: true, skills: true } });
    if (!t?.techCode) throw new AppError('NOT_FOUND', {}, 'submit the profile first');
    return t;
  }

  private async shortName(user: User): Promise<string> {
    return displayName(user.nameEnc ? await this.cipher.decrypt('users.name', user.nameEnc) : '');
  }

  private async person(t: Technician & { user: User }, withPhone: boolean): Promise<ApprenticePersonDto> {
    return {
      id: t.userId,
      name: await this.shortName(t.user),
      photo: t.photoUploadId && t.photoStatus === 'APPROVED' ? await this.media.photoUrl(t.photoUploadId) : null,
      techCode: t.techCode ?? '',
      rating: t.ratingAvg !== null ? Number(t.ratingAvg) : null,
      jobsDone: t.jobsDone,
      level: t.skillLevel,
      phone: withPhone ? await this.cipher.decrypt('users.phone', t.user.phoneEnc) : null,
    };
  }

  private async linkDto(l: { id: string; categoryId: CategoryId; state: ApprenticeLinkDto['state']; createdAt: Date }, other: Technician & { user: User }): Promise<ApprenticeLinkDto> {
    return { id: l.id, categoryId: l.categoryId, state: l.state, at: l.createdAt.getTime(), other: await this.person(other, l.state === 'ACTIVE') };
  }

  private async traineeJob(
    b: Prisma.BookingGetPayload<{ include: { events: true } }>,
    mentor: Technician & { user: User },
  ): Promise<TraineeJobDto> {
    const lastAt = b.events[0]?.at.getTime() ?? b.createdAt.getTime();
    const showAddress = (ACTIVE_STATUSES as readonly string[]).includes(b.status) || this.clock.now() - lastAt <= ADDRESS_AFTER_CLOSE_MS;
    const address = showAddress && b.addressSnapshotEnc.length > 0 ? (JSON.parse(await this.cipher.decrypt('bookings.address', b.addressSnapshotEnc)) as AddressDto) : null;
    return {
      id: b.id,
      code: b.code,
      serviceId: b.serviceId,
      categoryId: b.categoryId,
      status: b.status,
      time:
        b.timeMode === 'SCHEDULED' && b.windowDate && b.windowStartHour !== null && b.windowEndHour !== null
          ? { mode: 'SCHEDULED', window: { date: b.windowDate.toISOString().slice(0, 10), startHour: b.windowStartHour, endHour: b.windowEndHour } }
          : { mode: 'INSTANT', window: null },
      address,
      mentor: { name: await this.shortName(mentor.user), phone: await this.cipher.decrypt('users.phone', mentor.user.phoneEnc) },
      helped: b.traineeHelped,
      earning: b.traineeHelped && b.status === 'COMPLETED' ? this.config.APPRENTICE_SHARE_RUPEES : 0,
    };
  }
}
