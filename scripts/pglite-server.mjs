// A PostgreSQL-compatible server with PostGIS, without Docker: PGlite (Postgres compiled to WebAssembly) behind
// its wire-protocol socket server. Used by `npm test` when no DATABASE_URL_TEST is given, and by `npm run db:local`.
//
// Limits to know: PGlite is PostgreSQL 18 (production is 16) and has ONE session shared by every client. So:
// - several processes may connect (API, `npm run tech`, seed), but the socket server's queue runs one query at a
//   time and, while a transaction is open, only that connection's queries: transactions never interleave;
// - each URL carries connection_limit=1, so one process never waits on its own second connection mid-transaction;
// - the URL carries pgbouncer=true: Prisma then uses unnamed prepared statements, because named ones ("s0", ...)
//   would outlive a client in the shared session and collide with the next client's.
// Real concurrency is only exercised in CI (PostgreSQL 16).
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * pglite-socket 0.2.11 frees a connection slot only on the socket's "close" event, but when a client vanishes (a
 * killed dev server, a crashed test) the socket first errors with ECONNRESET, and the error path removes the
 * "close" listener. The slot then stays taken and every later connection is refused. Free it on errors too.
 * (The library's own error path already rolls back that client's open transaction.)
 */
class ReconnectingSocketServer extends PGLiteSocketServer {
  async handleConnection(socket) {
    const before = new Set(this.handlers);
    await super.handleConnection(socket);
    for (const handler of this.handlers) {
      if (!before.has(handler)) handler.addEventListener('error', () => this.handlers.delete(handler));
    }
  }
}

/** Splits a buffer of typed protocol messages into their type bytes; null if it is not exactly that (startup packet, a split message). */
function messageTypes(buf) {
  const types = [];
  let i = 0;
  while (i < buf.length) {
    if (buf[i] === 0 || i + 5 > buf.length) return null;
    const len = buf.readInt32BE(i + 1);
    if (len < 4 || i + 1 + len > buf.length) return null;
    types.push({ type: buf[i], start: i, end: i + 1 + len });
    i += 1 + len;
  }
  return types;
}

const READY = 0x5a; // 'Z'
const ERROR = 0x45; // 'E'
const SYNC = 0x53; // 'S'
const QUERY = 0x51; // 'Q'

/**
 * PGlite 0.5 answers an error in the extended protocol with ErrorResponse + ReadyForQuery straight away, and then a
 * second ReadyForQuery for the client's Sync. A real server sends one, after the Sync. Prisma's engine then reads
 * the extra one as the reply to its next query ("unexpected message from server") and drops the connection, so any
 * database error (a constraint, a trigger) broke the test connection. Pass on exactly one ReadyForQuery per Sync or
 * simple Query the client sent, dropping the surplus that follows an error.
 */
function fixReadyAfterError(db) {
  const original = db.execProtocolRawStream.bind(db);
  db.execProtocolRawStream = async (message, opts = {}) => {
    const input = messageTypes(Buffer.from(message));
    if (!input || !opts.onRawData) return original(message, opts);
    const chunks = [];
    const result = await original(message, { ...opts, onRawData: (d) => chunks.push(Buffer.from(d)) });
    const out = Buffer.concat(chunks);
    const replies = messageTypes(out);
    let surplus = replies ? replies.filter((m) => m.type === READY).length - input.filter((m) => m.type === SYNC || m.type === QUERY).length : 0;
    if (surplus <= 0 || !replies) {
      if (out.length) opts.onRawData(out);
      return result;
    }
    const kept = replies.filter((m, k) => {
      if (surplus > 0 && m.type === READY && replies[k - 1]?.type === ERROR) {
        surplus--;
        return false;
      }
      return true;
    });
    opts.onRawData(Buffer.concat(kept.map((m) => out.subarray(m.start, m.end))));
    return result;
  };
}

/** @param {{ port: number, dataDir?: string }} opts  dataDir omitted = in memory */
export async function startPgliteServer({ port, dataDir }) {
  const db = await PGlite.create({ ...(dataDir ? { dataDir } : {}), extensions: { postgis } });
  fixReadyAfterError(db);
  const server = new ReconnectingSocketServer({ db, port, host: '127.0.0.1', maxConnections: 8 });
  await server.start();
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?schema=public&connection_limit=1&pgbouncer=true&sslmode=disable`,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}
