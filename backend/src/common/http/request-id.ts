import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/** A caller-supplied id is kept only if it is short and harmless, so it can go into logs and responses as is. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Request id for logs, error bodies and the X-Request-Id response header. */
export function genReqId(req: IncomingMessage): string {
  const header = req.headers[REQUEST_ID_HEADER];
  const incoming = Array.isArray(header) ? header[0] : header;
  return incoming && SAFE_ID.test(incoming) ? incoming : `req_${randomUUID().replace(/-/g, '')}`;
}
