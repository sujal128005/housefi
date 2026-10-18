// Sending push notifications. Development and tests write them to the log; production uses the Expo push service
// (the app is an Expo app; Expo forwards to FCM for Android and APNs for iOS).
import { Logger } from '@nestjs/common';

export interface PushMessage {
  /** An Expo push token, "ExponentPushToken[...]". */
  readonly to: string;
  readonly title: string;
  readonly body: string;
  /** Read by the app when the notification is opened (no personal data). */
  readonly data: Readonly<Record<string, unknown>>;
  /** Job offers: high priority with sound, on the app's "job-offers" Android channel, dropped after the offer expires. */
  readonly priority: 'high' | 'default';
  readonly sound: 'default' | null;
  readonly channelId: string;
  readonly ttl?: number;
}

/** One result per message, in order. */
export type PushTicket = { readonly ok: true } | { readonly ok: false; readonly error: string; readonly deviceGone: boolean };

export interface PushSender {
  /** Throws PushUnavailable when the service could not take the batch (network, 429, 5xx): try again later. */
  send(messages: readonly PushMessage[]): Promise<PushTicket[]>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export class PushUnavailable extends Error {}

/** Expo push tokens; anything else (a raw FCM token, a web subscription) is not sent through Expo. */
export const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/;

/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH = 100;

export class LogPushSender implements PushSender {
  private readonly log = new Logger('Push');

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    for (const m of messages) this.log.log(`push (not sent, PUSH_PROVIDER=log) [${m.priority}] ${m.title}: ${m.body}`);
    return messages.map(() => ({ ok: true }));
  }
}

export interface ExpoOptions {
  readonly accessToken?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** https://docs.expo.dev/push-notifications/sending-notifications/ ("Send push notifications using the Expo push service"). */
export class ExpoPushSender implements PushSender {
  private readonly log = new Logger('Push');

  constructor(private readonly opts: ExpoOptions = {}) {}

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    if (messages.length === 0) return [];
    if (messages.length > EXPO_BATCH) throw new Error(`at most ${EXPO_BATCH} messages per request`);
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.opts.accessToken ? { authorization: `Bearer ${this.opts.accessToken}` } : {}),
        },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new PushUnavailable(`Expo push unreachable (${(err as Error).message})`);
    }
    const body = (await res.json().catch(() => ({}))) as { data?: ExpoTicket[]; errors?: { code?: string }[] };
    if (res.status === 429 || res.status >= 500) throw new PushUnavailable(`Expo push HTTP ${res.status}`);
    if (!res.ok || !Array.isArray(body.data) || body.data.length !== messages.length) {
      // A request-level error (bad credentials, malformed request) fails the whole batch; tokens are not logged.
      this.log.error(`Expo push rejected the batch (HTTP ${res.status}, ${body.errors?.map((e) => e.code).join(',') ?? 'no detail'})`);
      throw new PushUnavailable(`Expo push rejected the batch (HTTP ${res.status})`);
    }
    return body.data.map((t) =>
      t.status === 'ok' ? { ok: true as const } : { ok: false as const, error: t.details?.error ?? 'UNKNOWN', deviceGone: t.details?.error === 'DeviceNotRegistered' },
    );
  }
}
