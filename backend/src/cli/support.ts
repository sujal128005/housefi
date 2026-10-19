// `npm run support -- <command>`: the support queue, until the admin portal exists.
//   open                          open tickets, most urgent first (SOS, payment problems, call-backs, reports)
//   resolve <ticketId> "<what>"   close a ticket, saying what was done
//   unlock <phone>                lift a sign-in lock after wrong codes (confirm it is the person first)
//   unlock-start <booking>        give a technician new start-code tries after 5 wrong ones (booking code like
//                                 HF-48291, or its id; call both people first to check they are at the door)
// Resolutions are written to audit_log with who ran it. Runs against DATABASE_URL (or .env locally).
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
import { SupportModule } from '../modules/support/support.module';
import { type SupportActor, type SupportService, SupportService as Support } from '../modules/support/support.service';

export const USAGE = [
  'usage: npm run support -- <command>',
  '  open                          open tickets, most urgent first',
  '  resolve <ticketId> "<what>"   resolve a ticket',
  '  unlock <phone>                lift a sign-in lock after wrong codes',
  '  unlock-start <booking>        new start-code tries after too many wrong ones (code like HF-48291)',
].join('\n');

/** The command logic, separate from process wiring so it can be tested. Returns the lines to print. */
export async function runSupportCommand(args: readonly string[], support: SupportService, actor: SupportActor): Promise<string[]> {
  const [command, id, what] = args;
  if (command === 'open') {
    const rows = await support.open();
    if (rows.length === 0) return ['No open tickets.'];
    return rows.map(
      (t) => `${t.id}  ${t.priority}  ${t.kind}  ${t.bookingCode ?? '-'}  from ${t.raisedByRole.toLowerCase()}  ${t.createdAt.toISOString()}${t.note ? `  "${t.note.replace(/\s+/g, ' ').slice(0, 120)}"` : ''}`,
    );
  }
  if (command === 'unlock' && id) {
    return [(await support.unlockSignIn(id, actor)) ? 'Sign-in unlocked for that number.' : 'That number was not locked.'];
  }
  if (command === 'unlock-start' && id) {
    const done = await support.unlockStartCode(id, actor);
    return [`Start code unlocked for ${done.code}. The technician can enter the code again.${done.ticketsResolved > 0 ? ' Its support ticket is resolved.' : ''}`];
  }
  if (command === 'resolve' && id && what) {
    await support.resolve(id, what, actor);
    return [`Resolved ${id}.`];
  }
  return [USAGE];
}

@Module({})
class CliModule {
  static forRoot(config: Env): DynamicModule {
    return { module: CliModule, imports: [ConfigModule.forRoot(config), ClockModule, PrismaModule, CryptoModule, AuditModule, SupportModule] };
  }
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = parseEnv(process.env);
  const app = await NestFactory.createApplicationContext(CliModule.forRoot(config), { logger: ['error'] });
  try {
    const lines = await runSupportCommand(process.argv.slice(2), app.get(Support), { type: 'ADMIN', id: null, via: `cli:${userInfo().username}` });
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (err) {
    process.stderr.write(`${err instanceof AppError ? `${err.code}: ${err.message}` : (err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) void main();
