// `npm run db:local`: a local development database with PostGIS for machines without Docker. Data persists in
// .data/pglite. Prefer `docker compose up -d` when Docker is available: it is PostgreSQL 16 like production.
// Stop with Ctrl+C.
import { mkdirSync } from 'node:fs';
import { startPgliteServer } from './pglite-server.mjs';

const port = Number(process.env.LOCAL_DB_PORT ?? 5433);
mkdirSync('.data/pglite', { recursive: true });
const db = await startPgliteServer({ port, dataDir: '.data/pglite' });

console.log(`Local database (PGlite + PostGIS) on port ${port}. Put this in .env:\n\nDATABASE_URL=${db.url}\n`);
console.log('Then, in another terminal: npm run db:deploy && npm run db:seed && npm run dev');

const shutdown = async () => {
  await db.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
