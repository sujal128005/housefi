import { Global, Injectable, Module } from '@nestjs/common';
import type { ActorType, Prisma } from '@prisma/client';
import { type Clock, InjectClock } from '../clock';
import { PrismaService } from '../prisma/prisma.module';

export interface AuditEntry {
  readonly actorType: ActorType;
  readonly actorId: string | null;
  /** e.g. 'tech.approve'. */
  readonly action: string;
  readonly entity: string;
  readonly entityId: string;
  /** Ids, statuses and decisions only: no personal data (the log is kept long). */
  readonly before?: Prisma.InputJsonObject;
  readonly after?: Prisma.InputJsonObject;
  readonly requestId?: string;
  /** The network address of a privileged sign-in or action (the super admin portal). */
  readonly ip?: string;
}

/** Append-only record of privileged actions (README security checklist: "who, when, before, after"). */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  /** Pass the transaction client so the audit row commits (or rolls back) with the change it describes. */
  async record(entry: AuditEntry, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        ...(entry.before ? { before: entry.before } : {}),
        ...(entry.after ? { after: entry.after } : {}),
        requestId: entry.requestId ?? null,
        ...(entry.ip ? { ip: entry.ip } : {}),
        at: new Date(this.clock.now()),
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
