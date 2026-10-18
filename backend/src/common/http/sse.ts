// Server-Sent Events for "watch one object" streams (a booking for the customer, a job for the technician): the full
// object right away and again whenever it changes, plus heartbeat comments so proxies keep the connection open.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error';

export const STREAM_HEARTBEAT_MS = 25_000;
/** Open streams one signed-in user may hold on one API instance (the app needs one, two during a reconnect). */
export const MAX_STREAMS_PER_USER = 5;
const openStreams = new Map<string, number>();

export interface SseOptions<T> {
  /** SSE event name, e.g. 'booking' or 'job'. */
  readonly event: string;
  /** Already loaded (and authorised) before the stream opens, so errors still get the normal JSON error body. */
  readonly first: T;
  /** Loads the current object again. */
  readonly reload: () => Promise<T>;
  /** Calls `onChange` when the object may have changed; returns the unsubscribe function. */
  readonly subscribe: (onChange: () => void) => () => void;
}

export function streamSse<T>(req: FastifyRequest, reply: FastifyReply, opts: SseOptions<T>): void {
  const owner = req.user?.id ?? 'anonymous';
  const held = openStreams.get(owner) ?? 0;
  if (held >= MAX_STREAMS_PER_USER) throw new AppError('RATE_LIMITED', { retryAfterSec: 30 });
  openStreams.set(owner, held + 1);
  let counted = true;
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  let open = true;
  let last = JSON.stringify(opts.first);
  const send = (json: string) => {
    if (open) raw.write(`event: ${opts.event}\ndata: ${json}\n\n`);
  };
  raw.write('retry: 3000\n\n');
  send(last);

  const unsubscribe = opts.subscribe(() => {
    opts
      .reload()
      .then((value) => {
        const json = JSON.stringify(value);
        // Only when something visible changed.
        if (json !== last) {
          last = json;
          send(json);
        }
      })
      .catch((err: Error) => req.log.warn({ err }, `${opts.event} stream reload failed`));
  });
  // Each heartbeat also checks that the caller is still signed in: a stream ends when the access token expires or the
  // session is revoked (logout, deletion, block). The app reconnects with a fresh token.
  const heartbeat = setInterval(() => {
    if (!open) return;
    void (req.stillSignedIn ? req.stillSignedIn() : Promise.resolve(true))
      .catch(() => false)
      .then((ok) => {
        if (!open) return;
        if (ok) raw.write(': ping\n\n');
        else {
          close();
          raw.end();
        }
      });
  }, STREAM_HEARTBEAT_MS);
  const close = () => {
    open = false;
    clearInterval(heartbeat);
    unsubscribe();
    if (counted) {
      counted = false;
      const n = (openStreams.get(owner) ?? 1) - 1;
      if (n <= 0) openStreams.delete(owner);
      else openStreams.set(owner, n);
    }
  };
  raw.on('close', close);
  req.raw.on('close', close);
}
