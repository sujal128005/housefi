import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DevicePlatform, Locale, NotificationKind, Prisma, PushState } from '@prisma/client';
import { type Clock, InjectClock } from '../../common/clock';
import { PrismaService } from '../../common/prisma/prisma.module';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { NoticeParams } from './notifier';
import { EXPO_BATCH, EXPO_TOKEN, PUSH_SENDER, type PushMessage, type PushSender, PushUnavailable } from './push-sender';
import { pushText } from './push-texts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The inbox shows this many of the latest notifications. */
export const INBOX_LIMIT = 50;
/** Push attempts before giving up on a notification (it stays in the inbox). */
export const MAX_PUSH_ATTEMPTS = 3;
/** A push older than this is not worth sending any more (a job offer: once it expired). */
export const PUSH_MAX_AGE_MS = 60 * 60_000;
/** A claim this old belongs to a worker that died: the notification is picked up again. */
const STALE_CLAIM_MS = 2 * 60_000;

/** openapi.yaml AppNotification. */
export interface NotificationDto {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly bookingId: string | null;
  readonly params: NoticeParams;
  readonly at: number;
  readonly read: boolean;
}

export interface DeliveryResult {
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
  /** Left for the next run (the push service was unavailable). */
  readonly retry: number;
}

interface Claimed {
  id: string;
  user_id: string;
  kind: NotificationKind;
  booking_id: string | null;
  params: NoticeParams;
  created_at: Date;
  push_attempts: number;
}

interface LiveDevice {
  id: string;
  user_id: string;
  push_token: string;
  locale: Locale;
}

/** The inbox, push-token registration, and push delivery of what the Notifier wrote. */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  // ---------- inbox ----------

  async list(userId: string): Promise<NotificationDto[]> {
    // A notice written for later (Notice.at) appears from then on.
    const rows = await this.prisma.notification.findMany({ where: { userId, createdAt: { lte: new Date(this.clock.now()) } }, orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }], take: INBOX_LIMIT });
    return rows.map((n) => ({ id: n.id, kind: n.kind, bookingId: n.bookingId, params: n.params as NoticeParams, at: n.createdAt.getTime(), read: n.readAt !== null }));
  }

  /** Marks the caller's own notifications read; other ids (someone else's, unknown, malformed) are ignored. */
  async markRead(userId: string, ids: readonly string[]): Promise<void> {
    const valid = ids.filter((id) => UUID.test(id));
    if (valid.length === 0) return;
    await this.prisma.notification.updateMany({ where: { id: { in: valid }, userId, readAt: null }, data: { readAt: new Date(this.clock.now()) } });
  }

  // ---------- devices ----------

  /**
   * Stores the push token for this account and sign-in session. A token belongs to one phone, so registering it moves
   * it to whoever is signed in there now; pushes stop when the session ends (logout, revoked, expired).
   */
  async registerDevice(userId: string, sessionId: string, pushToken: string, platform: DevicePlatform): Promise<void> {
    const now = new Date(this.clock.now());
    await this.prisma.device.upsert({
      where: { pushToken },
      create: { userId, sessionId, pushToken, platform, lastSeenAt: now, createdAt: now },
      update: { userId, sessionId, platform, lastSeenAt: now },
    });
  }

  /** Account deletion: the inbox and the devices go (the inbox is the user's own data). */
  async forgetUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.device.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
  }

  // ---------- push delivery ----------

  /** Sends pushes for notifications waiting for one (oldest first). Safe to run on several instances at once. */
  async deliverPending(batch = 200): Promise<DeliveryResult> {
    const now = this.clock.now();
    const claimed = await this.prisma.$queryRaw<Claimed[]>`
      UPDATE notifications SET push_state = 'SENDING', push_claimed_at = ${new Date(now)}, push_attempts = push_attempts + 1
      WHERE id IN (
        SELECT id FROM notifications
        WHERE (push_state = 'PENDING' AND created_at <= ${new Date(now)}) OR (push_state = 'SENDING' AND push_claimed_at < ${new Date(now - STALE_CLAIM_MS)})
        ORDER BY created_at, seq LIMIT ${batch} FOR UPDATE SKIP LOCKED)
      RETURNING id, user_id, kind, booking_id, params, created_at, push_attempts`;
    if (claimed.length === 0) return { sent: 0, skipped: 0, failed: 0, retry: 0 };

    const fresh = claimed.filter((n) => now - n.created_at.getTime() <= this.maxAgeMs(n.kind));
    const devices = await this.liveDevices([...new Set(fresh.map((n) => n.user_id))], now);
    const byUser = new Map<string, LiveDevice[]>();
    for (const d of devices) byUser.set(d.user_id, [...(byUser.get(d.user_id) ?? []), d]);

    const outbox: { notificationId: string; deviceId: string; message: PushMessage }[] = [];
    for (const n of fresh) {
      for (const d of byUser.get(n.user_id) ?? []) outbox.push({ notificationId: n.id, deviceId: d.id, message: this.message(n, d, now) });
    }

    const ok = new Set<string>();
    const unavailable = new Set<string>();
    const gone = new Set<string>();
    for (let i = 0; i < outbox.length; i += EXPO_BATCH) {
      const chunk = outbox.slice(i, i + EXPO_BATCH);
      try {
        const tickets = await this.push.send(chunk.map((c) => c.message));
        tickets.forEach((t, k) => {
          const c = chunk[k]!;
          if (t.ok) ok.add(c.notificationId);
          else if (t.deviceGone) gone.add(c.deviceId);
          else this.log.warn(`push for notification ${c.notificationId} refused (${t.error})`);
        });
      } catch (err) {
        if (!(err instanceof PushUnavailable)) throw err;
        this.log.warn(err.message);
        for (const c of chunk) unavailable.add(c.notificationId);
      }
    }
    if (gone.size > 0) await this.prisma.device.deleteMany({ where: { id: { in: [...gone] } } });

    const state = new Map<PushState, string[]>();
    const set = (s: PushState, id: string) => state.set(s, [...(state.get(s) ?? []), id]);
    let retry = 0;
    for (const n of claimed) {
      const queued = outbox.some((o) => o.notificationId === n.id);
      if (ok.has(n.id)) set('SENT', n.id);
      else if (unavailable.has(n.id)) {
        if (n.push_attempts >= MAX_PUSH_ATTEMPTS) set('FAILED', n.id);
        else {
          set('PENDING', n.id);
          retry++;
        }
      } else if (!queued) set('SKIPPED', n.id); // too old, or no live device with an Expo token
      else set('FAILED', n.id); // every device refused it
    }
    for (const [s, ids] of state) {
      await this.prisma.notification.updateMany({
        where: { id: { in: ids }, pushState: 'SENDING' },
        data: { pushState: s, pushClaimedAt: null, ...(s === 'SENT' ? { pushedAt: new Date(now) } : {}) },
      });
    }
    return { sent: state.get('SENT')?.length ?? 0, skipped: state.get('SKIPPED')?.length ?? 0, failed: state.get('FAILED')?.length ?? 0, retry };
  }

  private maxAgeMs(kind: NotificationKind): number {
    return kind === 'JOB_OFFER' ? this.config.OFFER_TIMEOUT_SEC * 1000 : PUSH_MAX_AGE_MS;
  }

  /** Devices of active accounts whose sign-in session is still live, with an Expo push token. */
  private async liveDevices(userIds: readonly string[], now: number): Promise<LiveDevice[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<LiveDevice[]>`
      SELECT d.id, d.user_id, d.push_token, u.locale FROM devices d JOIN users u ON u.id = d.user_id
      WHERE d.user_id = ANY(${userIds}::uuid[]) AND u.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM refresh_tokens r WHERE r.family_id = d.session_id AND r.user_id = d.user_id
                    AND r.revoked_at IS NULL AND r.used_at IS NULL AND r.expires_at > ${new Date(now)})
      ORDER BY d.created_at`;
    return rows.filter((d) => EXPO_TOKEN.test(d.push_token));
  }

  private message(n: Claimed, d: LiveDevice, now: number): PushMessage {
    const { title, body } = pushText(n.kind, d.locale, n.params);
    const data = { notificationId: n.id, kind: n.kind, bookingId: n.booking_id, params: n.params };
    if (n.kind === 'JOB_OFFER') {
      const left = Math.max(1, Math.ceil((n.created_at.getTime() + this.config.OFFER_TIMEOUT_SEC * 1000 - now) / 1000));
      return { to: d.push_token, title, body, data, priority: 'high', sound: 'default', channelId: 'job-offers', ttl: left };
    }
    return { to: d.push_token, title, body, data, priority: 'default', sound: 'default', channelId: 'default' };
  }
}
