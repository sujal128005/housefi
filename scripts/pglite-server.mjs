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

/** @param {{ port: number, dataDir?: string }} opts  dataDir omitted = in memory */
export async function startPgliteServer({ port, dataDir }) {
  const db = await PGlite.create({ ...(dataDir ? { dataDir } : {}), extensions: { postgis } });
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
