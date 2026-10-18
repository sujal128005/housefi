// `npm run coordinators -- <command>`: coordinator accounts, until the admin portal exists.
//   add <phone> "<name>"                       create a coordinator (they sign in with an SMS code, role COORDINATOR)
//   link <technician id|phone> <coord id|phone> the coordinator assigns and acts for this technician
//   unlink <technician id|phone>               the technician has no coordinator
//   block <coord id|phone>                     end their sessions and stop them signing in
//   list                                       coordinators and their technicians
// Every change is written to audit_log with who ran it. Runs against DATABASE_URL (or .env locally).
import { type DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { AuditModule } from '../common/audit/audit.module';
import { ClockModule } from '../common/clock';
import { CryptoModule } from '../common/crypto/crypto.module';
import { AppError } from '../common/errors/app-error';
import { PrismaModule } from '../common/prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { type Env, parseEnv } from '../config/env';
import { type AdminActor, type CoordinatorAccountsService, CoordinatorAccountsService as Accounts } from '../modules/coordinator/coordinator-accounts.service';
import { CoordinatorAccountsModule } from '../modules/coordinator/coordinator.module';
import { NotifierModule } from '../modules/notifications/notifier';

export const USAGE = [
  'usage: npm run coordinators -- <command>',
  '  add <phone> "<name>"                         create a coordinator account',
  '  link <technician id|phone> <coord id|phone>  link a technician to a coordinator',
  '  unlink <technician id|phone>                 remove the technician\'s coordinator',
  '  block <coord id|phone>                       block a coordinator',
  '  list                                         coordinators and their technicians',
].join('\n');

/** The command logic, separate from process wiring so it can be tested. Returns the lines to print. */
export async function runCoordinatorsCommand(args: readonly string[], accounts: CoordinatorAccountsService, actor: AdminActor): Promise<string[]> {
  const [command, a, b] = args;
  if (command === 'add' && a && b) return [`Created coordinator ${await accounts.add(a, b, actor)}.`];
  if (command === 'link' && a && b) {
    await accounts.link(a, b, actor);
    return ['Linked.'];
  }
  if (command === 'unlink' && a) {
    await accounts.unlink(a, actor);
    return ['Unlinked.'];
  }
  if (command === 'block' && a) {
    await accounts.block(a, actor);
    return ['Blocked.'];
  }
  if (command === 'list') {
    const rows = await accounts.list();
    if (rows.length === 0) return ['No coordinators.'];
    return rows.flatMap((c) => [
      `${c.id}  ${c.name}  ${c.status}  ${c.technicians.length} technician(s)`,
      ...c.technicians.map((t) => `    ${t.id}  ${t.name}  ${t.phoneType}`),
    ]);
  }
  return [USAGE];
}

@Module({})
class CliModule {
  static forRoot(config: Env): DynamicModule {
    return { module: CliModule, imports: [ConfigModule.forRoot(config), ClockModule, PrismaModule, CryptoModule, AuditModule, NotifierModule, CoordinatorAccountsModule] };
  }
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = parseEnv(process.env);
  const app = await NestFactory.createApplicationContext(CliModule.forRoot(config), { logger: ['error'] });
  try {
    const lines = await runCoordinatorsCommand(process.argv.slice(2), app.get(Accounts), { id: null, via: `cli:${userInfo().username}` });
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (err) {
    process.stderr.write(`${err instanceof AppError ? `${err.code}: ${err.message}` : (err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) void main();
