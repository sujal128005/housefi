import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { Hashing } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { TechVerificationService } from '../technicians/tech-verification.service';

const PHONE = /^[6-9][0-9]{9}$/;

export interface AdminActor {
  /** Null for the command line (who ran it is in `via`). */
  readonly id: string | null;
  readonly via: string;
}

export interface CoordinatorRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly technicians: readonly { readonly id: string; readonly name: string; readonly phoneType: string }[];
}

/**
 * Coordinator accounts and which technicians they look after. Admin only (the `npm run coordinators` command line
 * until the admin portal exists); never reachable over HTTP, and every change is audited.
 */
@Injectable()
export class CoordinatorAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly hashing: Hashing,
    private readonly audit: AuditService,
    private readonly technicians: TechVerificationService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** Creates a coordinator who can then sign in with an SMS code (role COORDINATOR). */
  async add(phone: string, name: string, actor: AdminActor): Promise<string> {
    if (!PHONE.test(phone)) throw new AppError('VALIDATION', { fields: { phone: 'INVALID' } });
    const clean = name.trim();
    if (clean.length < 2) throw new AppError('VALIDATION', { fields: { name: 'INVALID' } });
    const phoneHash = this.hashing.phone(phone);
    if (await this.prisma.user.findUnique({ where: { role_phoneHash: { role: 'COORDINATOR', phoneHash } } })) throw new AppError('CONFLICT', {}, 'a coordinator with that phone exists');
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { role: 'COORDINATOR', phoneHash, phoneEnc: await this.cipher.encrypt('users.phone', phone), nameEnc: await this.cipher.encrypt('users.name', clean) },
      });
      await this.audit.record({ actorType: 'ADMIN', actorId: actor.id, action: 'coordinator.add', entity: 'user', entityId: user.id, after: { role: 'COORDINATOR', via: actor.via } }, tx);
      return user.id;
    });
  }

  /** Links a technician (id or phone) to a coordinator (id or phone); the coordinator can then assign and act for them. */
  async link(technician: string, coordinator: string, actor: AdminActor): Promise<void> {
    const technicianId = await this.technicians.resolve(technician);
    const coordinatorId = await this.resolve(coordinator);
    await this.setCoordinator(technicianId, coordinatorId, actor);
  }

  async unlink(technician: string, actor: AdminActor): Promise<void> {
    await this.setCoordinator(await this.technicians.resolve(technician), null, actor);
  }

  /** Blocks a coordinator: sessions end at once, their technicians stay linked (relink them to someone else). */
  async block(coordinator: string, actor: AdminActor): Promise<void> {
    const id = await this.resolve(coordinator);
    const now = new Date(this.clock.now());
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: 'BLOCKED' } });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      await this.audit.record({ actorType: 'ADMIN', actorId: actor.id, action: 'coordinator.block', entity: 'user', entityId: id, before: { status: 'ACTIVE' }, after: { status: 'BLOCKED', via: actor.via } }, tx);
    });
  }

  async list(): Promise<CoordinatorRow[]> {
    const users = await this.prisma.user.findMany({ where: { role: 'COORDINATOR' }, orderBy: { createdAt: 'asc' } });
    const name = async (enc: Uint8Array | null) => (enc ? this.cipher.decrypt('users.name', enc) : '');
    return Promise.all(
      users.map(async (u) => {
        const techs = await this.prisma.technician.findMany({ where: { coordinatorId: u.id }, include: { user: { select: { nameEnc: true } } } });
        return {
          id: u.id,
          name: await name(u.nameEnc),
          status: u.status,
          technicians: await Promise.all(techs.map(async (t) => ({ id: t.userId, name: await name(t.user.nameEnc), phoneType: t.phoneType }))),
        };
      }),
    );
  }

  private async setCoordinator(technicianId: string, coordinatorId: string | null, actor: AdminActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.technician.findUniqueOrThrow({ where: { userId: technicianId }, select: { coordinatorId: true } });
      await tx.technician.update({ where: { userId: technicianId }, data: { coordinatorId } });
      await this.audit.record(
        { actorType: 'ADMIN', actorId: actor.id, action: coordinatorId ? 'coordinator.link' : 'coordinator.unlink', entity: 'technician', entityId: technicianId, before: { coordinatorId: before.coordinatorId }, after: { coordinatorId, via: actor.via } },
        tx,
      );
    });
  }

  private async resolve(idOrPhone: string): Promise<string> {
    const where = PHONE.test(idOrPhone)
      ? { role_phoneHash: { role: 'COORDINATOR' as const, phoneHash: this.hashing.phone(idOrPhone) } }
      : /^[0-9a-f-]{36}$/i.test(idOrPhone)
        ? { id: idOrPhone }
        : null;
    const user = where ? await this.prisma.user.findUnique({ where }) : null;
    if (!user || user.role !== 'COORDINATOR') throw new AppError('NOT_FOUND', {}, 'no coordinator with that id or phone');
    return user.id;
  }
}
