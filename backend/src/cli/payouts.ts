// `npm run payouts -- <command>`: the weekly technician payout, until RazorpayX automates it.
//   prepare                  every Monday: one payout per technician for the balance up to last Sunday (IST)
//   list [STATE]             payouts in a state (PENDING by default), oldest first
//   paid <payoutId> <ref>    the bank / UPI transfer went through (ref = the transfer's reference)
//   failed <payoutId>        the transfer failed; the amounts go back into next week's run
// Every change is written to audit_log with who ran it. Runs against DATABASE_URL (or .env locally).
import { type DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PayoutState } from '@prisma/client';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { AuditModule } from '../common/audit/audit.module';
import { ClockModule } from '../common/clock';
import { CryptoModule } from '../common/crypto/crypto.module';
import { AppError } from '../common/errors/app-error';
import { PrismaModule } from '../common/prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { type Env, parseEnv } from '../config/env';
import { EarningsModule } from '../modules/earnings/earnings.module';
import { type EarningsService, EarningsService as Earnings, type PayoutActor, type PayoutRow } from '../modules/earnings/earnings.service';

export const USAGE = [
  'usage: npm run payouts -- <command>',
  '  prepare                 create this week\'s payouts (balances up to last Sunday)',
  '  list [STATE]            payouts in a state: PENDING (default), PROCESSING, PAID, FAILED',
  '  paid <payoutId> <ref>   mark a payout paid with the transfer reference',
  '  failed <payoutId>       mark a payout failed (its amounts go into the next run)',
].join('\n');

const STATES: readonly PayoutState[] = ['PENDING', 'PROCESSING', 'PAID', 'FAILED'];

const line = (p: PayoutRow) =>
  `${p.id}  ${p.state}  Rs ${p.amount}  ${p.technicianName || '(no name)'} (${p.technicianId})  ${p.periodStart}..${p.periodEnd}${p.providerRef ? `  ref ${p.providerRef}` : ''}`;

/** The command logic, separate from process wiring so it can be tested. Returns the lines to print. */
export async function runPayoutsCommand(args: readonly string[], earnings: EarningsService, actor: PayoutActor): Promise<string[]> {
  const [command, id, ref] = args;
  if (command === 'prepare') {
    const created = await earnings.prepare(actor);
    return created.length ? [`Prepared ${created.length} payout(s):`, ...created.map(line)] : ['Nothing to pay out.'];
  }
  if (command === 'list') {
    const state = (id ?? 'PENDING').toUpperCase() as PayoutState;
    if (!STATES.includes(state)) return [USAGE];
    const rows = await earnings.list(state);
    return rows.length ? rows.map(line) : [`No ${state} payouts.`];
  }
  if (command === 'paid' && id && ref) return [`Marked paid: ${line(await earnings.markPaid(id, ref, actor))}`];
  if (command === 'failed' && id) return [`Marked failed: ${line(await earnings.markFailed(id, actor))}`];
  return [USAGE];
}

@Module({})
class CliModule {
  static forRoot(config: Env): DynamicModule {
    return { module: CliModule, imports: [ConfigModule.forRoot(config), ClockModule, PrismaModule, CryptoModule, AuditModule, EarningsModule] };
  }
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = parseEnv(process.env);
  const app = await NestFactory.createApplicationContext(CliModule.forRoot(config), { logger: ['error'] });
  try {
    const actor: PayoutActor = { type: 'ADMIN', id: null, via: `cli:${userInfo().username}` };
    const lines = await runPayoutsCommand(process.argv.slice(2), app.get(Earnings), actor);
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (err) {
    process.stderr.write(`${err instanceof AppError ? `${err.code}: ${err.message}` : (err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) void main();
