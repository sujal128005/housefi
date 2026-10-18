// Runs Jest against a real database. Uses DATABASE_URL_TEST when set (CI: PostgreSQL 16 + PostGIS, or your own
// database); otherwise starts an in-memory PGlite with PostGIS (scripts/pglite-server.mjs), so `npm test` works
// without Docker. Migrations are applied first, exactly as in production (`prisma migrate deploy`).
// Extra arguments go to Jest.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { startPgliteServer } from './pglite-server.mjs';

const jestBin = join('node_modules', 'jest', 'bin', 'jest.js');
const prismaBin = join('node_modules', 'prisma', 'build', 'index.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Runs a Node script as a child process without blocking: the PGlite server in this process must keep serving. */
function run(script, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

let url = process.env.DATABASE_URL_TEST;
let local = null;

async function stop() {
  if (local) await local.stop().catch(() => undefined);
  local = null;
}
process.on('SIGINT', () => void stop().then(() => process.exit(130)));

try {
  if (!url) {
    local = await startPgliteServer({ port: await freePort() });
    url = local.url;
    console.log('[test] in-memory PGlite + PostGIS (CI runs PostgreSQL 16)');
  }
  if ((await run(prismaBin, ['migrate', 'deploy'], { DATABASE_URL: url })) !== 0) throw new Error('prisma migrate deploy failed');
  const code = await run(jestBin, process.argv.slice(2), { DATABASE_URL_TEST: url });
  await stop();
  process.exit(code);
} catch (err) {
  console.error(`[test] ${err.message}`);
  await stop();
  process.exit(1);
}
