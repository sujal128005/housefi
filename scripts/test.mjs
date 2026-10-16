// Runs Jest against a real PostgreSQL. Uses DATABASE_URL_TEST when set (CI, or your own database); otherwise starts
// an embedded PostgreSQL 16 in a temporary folder, so `npm test` works without Docker. Migrations are applied
// first, exactly as in production (`prisma migrate deploy`). Extra arguments go to Jest.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const node = process.execPath;
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

let url = process.env.DATABASE_URL_TEST;
let pg = null;

async function stop() {
  if (pg) await pg.stop().catch(() => undefined);
  pg = null;
}
process.on('SIGINT', () => void stop().then(() => process.exit(130)));

try {
  if (!url) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const port = await freePort();
    // A short path under the system temp folder: initdb fails on very long Windows paths.
    const dir = mkdtempSync(join(tmpdir(), 'hfpg-'));
    pg = new EmbeddedPostgres({
      databaseDir: dir, port, user: 'housefi', password: 'housefi', persistent: false,
      initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('housefi_test');
    url = `postgresql://housefi:housefi@127.0.0.1:${port}/housefi_test?schema=public`;
    console.log(`[test] embedded PostgreSQL 16 on port ${port}`);
  }

  const migrate = spawnSync(node, [prismaBin, 'migrate', 'deploy'], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, DATABASE_URL: url } });
  if (migrate.status !== 0) {
    process.stdout.write(migrate.stdout ?? '');
    throw new Error('prisma migrate deploy failed');
  }

  const jest = spawnSync(node, [jestBin, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, DATABASE_URL_TEST: url } });
  await stop();
  process.exit(jest.status ?? 1);
} catch (err) {
  console.error(`[test] ${err.message}`);
  await stop();
  process.exit(1);
}
