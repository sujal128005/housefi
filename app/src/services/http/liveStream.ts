// Live updates for one booking or job. The API streams the whole record as Server-Sent Events (`event: booking` / `job`)
// at once and after every change. React Native's fetch cannot read a response while it is still arriving, so the stream
// is read with XMLHttpRequest (whose responseText grows as data arrives), with the Authorization header the API needs.
// The server ends a stream when the access token expires or the session ends; it then reconnects with a fresh token.
// If streaming is not possible at all, it falls back to asking every few seconds.
import { isApiError } from '../api';

export interface StreamOptions<T> {
  /** Full URL of the stream. */
  readonly url: string;
  /** SSE event name carrying the record. */
  readonly event: string;
  /** A valid access token (refreshed by the caller when needed; force after the server refused one). */
  readonly accessToken: (force: boolean) => Promise<string>;
  readonly decode: (json: unknown) => T;
  /** One-off read, for the polling fallback. */
  readonly fetchOnce: () => Promise<T>;
  readonly onChange: (value: T) => void;
  readonly onError?: (e: unknown) => void;
  readonly pollMs?: number;
  /** Injected in tests. */
  readonly makeXhr?: () => XMLHttpRequest;
}

const MAX_BACKOFF_MS = 30_000;

/** Parses complete SSE events out of the text received so far; returns them and how much text they used. */
export function parseSse(text: string): { readonly events: readonly { event: string; data: string }[]; readonly used: number } {
  const events: { event: string; data: string }[] = [];
  let used = 0;
  for (;;) {
    const end = text.indexOf('\n\n', used);
    if (end < 0) break;
    const block = text.slice(used, end);
    used = end + 2;
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue; // heartbeat comment
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, used };
}

export function openLiveStream<T>(o: StreamOptions<T>): () => void {
  let stopped = false;
  let xhr: XMLHttpRequest | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  const pollMs = o.pollMs ?? 5000;
  const canStream = typeof XMLHttpRequest !== 'undefined' || !!o.makeXhr;

  const later = (fn: () => void, ms: number) => {
    if (stopped) return;
    timer = setTimeout(fn, ms);
  };

  async function poll(): Promise<void> {
    if (stopped) return;
    try {
      o.onChange(await o.fetchOnce());
      failures = 0;
    } catch (e) {
      failures++;
      o.onError?.(e);
      if (isApiError(e, 'UNAUTHENTICATED') || isApiError(e, 'NOT_FOUND')) return; // nothing more to watch
    }
    later(() => void poll(), Math.min(pollMs * 2 ** Math.min(failures, 3), MAX_BACKOFF_MS));
  }

  async function connect(force: boolean): Promise<void> {
    if (stopped) return;
    let token: string;
    try {
      token = await o.accessToken(force);
    } catch (e) {
      o.onError?.(e);
      if (isApiError(e, 'UNAUTHENTICATED')) return;
      failures++;
      later(() => void connect(false), Math.min(1000 * 2 ** failures, MAX_BACKOFF_MS));
      return;
    }
    if (stopped) return;
    const x = o.makeXhr ? o.makeXhr() : new XMLHttpRequest();
    xhr = x;
    let seen = 0;
    let buffer = '';
    let gotData = false;
    x.open('GET', o.url);
    x.setRequestHeader('Accept', 'text/event-stream');
    x.setRequestHeader('Authorization', `Bearer ${token}`);
    const drain = () => {
      const text = x.responseText ?? '';
      buffer += text.slice(seen);
      seen = text.length;
      const { events, used } = parseSse(buffer);
      buffer = buffer.slice(used);
      for (const ev of events) {
        if (ev.event !== o.event) continue;
        try {
          o.onChange(o.decode(JSON.parse(ev.data)));
          gotData = true;
          failures = 0;
        } catch (e) {
          o.onError?.(e);
        }
      }
    };
    x.onprogress = drain;
    x.onreadystatechange = () => {
      if (x.readyState !== 4 || stopped || xhr !== x) return;
      drain();
      xhr = null;
      if (x.status === 401) return void connect(true);
      if (x.status === 404) {
        void poll(); // reports NOT_FOUND through onError and stops
        return;
      }
      // Closed normally (token expiry, server restart) or failed: reconnect, falling back to polling after repeated failures.
      if (!gotData) failures++;
      if (failures >= 3) void poll();
      else later(() => void connect(false), gotData ? 500 : Math.min(1000 * 2 ** failures, MAX_BACKOFF_MS));
    };
    x.send();
  }

  if (canStream) void connect(false);
  else void poll();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (xhr) {
      xhr.onreadystatechange = null;
      xhr.onprogress = null;
      xhr.abort();
    }
  };
}
