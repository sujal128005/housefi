// The outbox: any module writes notifications in the same transaction as the change they announce, so a rolled-back
// change never notifies and a committed one always does. Delivery (push) happens after commit, in
// NotificationsDelivery. Global, and depending on nothing above infrastructure, so every module (and the CLI) can use it.
import { Global, Injectable, Module } from '@nestjs/common';
import type { NotificationKind, Prisma } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';

export type NoticeParams = Readonly<Record<string, string | number>>;

export interface Notice {
  readonly userId: string;
  readonly kind: NotificationKind;
  readonly bookingId: string | null;
  /** Codes, amounts and ids for the text; never names, phone numbers or addresses. */
  readonly params: NoticeParams;
}

@Injectable()
export class Notifier {
  private readonly listeners = new Set<() => void>();

  constructor(@InjectClock() private readonly clock: Clock) {}

  /** Records the notices (inbox rows waiting for push) in `tx`, then nudges the delivery worker, if one runs here. */
  async enqueue(tx: Prisma.TransactionClient, notices: readonly Notice[]): Promise<void> {
    if (notices.length === 0) return;
    const createdAt = new Date(this.clock.now());
    await tx.notification.createMany({
      data: notices.map((n) => ({ userId: n.userId, kind: n.kind, bookingId: n.bookingId, params: n.params, createdAt })),
    });
    for (const listener of this.listeners) listener();
  }

  /** The delivery worker subscribes to deliver soon after a commit (it also sweeps, for anything written elsewhere). */
  onEnqueued(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

@Global()
@Module({ providers: [Notifier], exports: [Notifier] })
export class NotifierModule {}
