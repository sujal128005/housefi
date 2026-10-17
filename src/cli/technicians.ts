// `npm run tech -- <command>`: technician verification from the command line, until the admin portal exists.
//   pending                              list profiles waiting for review (oldest first)
//   approve <id|phone>                   approve; the technician can go online
//   correct <id|phone> "<note>" ["<te>"] send the profile back with a note (English, optional Telugu)
// Every decision is written to audit_log with who ran it. Runs against DATABASE_URL (or .env locally).
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
import { type TechVerificationService, TechVerificationService as Verification, type VerificationActor } from '../modules/technicians/tech-verification.service';
import { TechniciansModule } from '../modules/technicians/technicians.module';

export const USAGE = [
  'usage: npm run tech -- <command>',
  '  pending                               list profiles waiting for review',
  '  approve <id|phone>                    approve a pending profile',
  '  correct <id|phone> "<note>" ["<te>"]  send a pending profile back with a note',
].join('\n');

/** The command logic, separate from process wiring so it can be tested. Returns the lines to print. */
export async function runTechCommand(args: readonly string[], verification: TechVerificationService, actor: VerificationActor): Promise<string[]> {
  const [command, target, note, noteTe] = args;
  if (command === 'pending') {
    const rows = await verification.pending();
    if (rows.length === 0) return ['No profiles waiting for review.'];
    return rows.map(
      (t) =>
        `${t.id}  ${t.name} (${t.gender}, ${t.experienceYears} yrs)  ${t.phone}  ${t.skills.join('+')}  ${t.city} ${t.pincode} [${t.areas}]` +
        `${t.vehicle ? `  vehicle: ${t.vehicle}` : ''}  submitted ${t.submittedAt.toISOString()}`,
    );
  }
  if ((command === 'approve' || command === 'correct') && target) {
    const id = await verification.resolve(target);
    if (command === 'approve') {
      await verification.approve(id, actor);
      return [`Approved ${id}.`];
    }
    if (!note) return [USAGE];
    await verification.requestCorrection(id, { en: note, ...(noteTe ? { te: noteTe } : {}) }, actor);
    return [`Sent ${id} back for correction.`];
  }
  return [USAGE];
}

@Module({})
class CliModule {
  static forRoot(config: Env): DynamicModule {
    return { module: CliModule, imports: [ConfigModule.forRoot(config), ClockModule, PrismaModule, CryptoModule, AuditModule, TechniciansModule] };
  }
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = parseEnv(process.env);
  const app = await NestFactory.createApplicationContext(CliModule.forRoot(config), { logger: ['error'] });
  try {
    const actor: VerificationActor = { type: 'ADMIN', id: null, via: `cli:${userInfo().username}` };
    const lines = await runTechCommand(process.argv.slice(2), app.get(Verification), actor);
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (err) {
    process.stderr.write(`${err instanceof AppError ? `${err.code}: ${err.message}` : (err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) void main();
