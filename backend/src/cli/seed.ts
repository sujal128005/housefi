// `npm run db:seed`: loads the catalog into the database configured in the environment (or .env locally).
// Safe to run repeatedly, including on every deploy after `prisma migrate deploy`.
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { parseEnv } from '../config/env';
import { seedCatalog } from '../modules/catalog/catalog.seed';

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = parseEnv(process.env);
  const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
  try {
    const r = await seedCatalog(prisma);
    const deactivated = r.deactivated.length ? `; deactivated ${r.deactivated.join(', ')}` : '';
    process.stdout.write(`Catalog seeded: ${r.categories} categories, ${r.services} services, ${r.issues} issues${deactivated}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
