// `npm run tech -- <command>`: technician verification from the command line, until the admin portal exists.
//   pending                              list profiles waiting for review (oldest first)
//   approve <id|phone>                   approve; the technician can go online
//   correct <id|phone> "<note>" ["<te>"] send the profile back with a note (English, optional Telugu)
//   suspend <id|phone> "<reason>"        withdraw an approval (offline at once; the QR page shows "not active")
//   reinstate <id|phone> "<reason>"      lift a suspension
//   reject <id|phone> "<reason>"         refuse a pending profile for good
//   name <id|phone> "<legal name>"       apply a checked legal-name correction
//   new-photo <id|phone>                 let the technician send a new registration photo
//   reissue-qr <id|phone>                new QR link for the ID card; the old one stops working
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
import { NotifierModule } from '../modules/notifications/notifier';
import { type Env, parseEnv } from '../config/env';
import { type TechVerificationService, TechVerificationService as Verification, type VerificationActor } from '../modules/technicians/tech-verification.service';
import { TechniciansModule } from '../modules/technicians/technicians.module';

export const USAGE = [
  'usage: npm run tech -- <command>',
  '  pending                               list profiles waiting for review',
  '  approve <id|phone>                    approve a pending profile',
  '  correct <id|phone> "<note>" ["<te>"]  send a pending profile back with a note',
  '  suspend <id|phone> "<reason>"         withdraw an approval',
  '  reinstate <id|phone> "<reason>"       lift a suspension',
  '  reject <id|phone> "<reason>"          refuse a pending profile',
  '  name <id|phone> "<legal name>"        apply a checked legal-name correction',
  '  new-photo <id|phone>                  allow a new registration photo',
  '  reissue-qr <id|phone>                 new QR link (the old one stops working)',
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
        `${t.vehicle ? `  vehicle: ${t.vehicle}` : ''}  submitted ${t.submittedAt.toISOString()}  promised by ${t.reviewBy.toISOString()}` +
        `  ID ${t.techCode ?? '-'}  photo ${t.photo}  Aadhaar ${t.aadhaar}${t.correction ? `  correction asked: ${t.correction}` : ''}`,
    );
  }
  const actions: Record<string, (id: string) => Promise<string>> = {
    suspend: async (id) => (await verification.suspend(id, note ?? '', actor), `Suspended ${id}.`),
    reinstate: async (id) => (await verification.reinstate(id, note ?? '', actor), `Reinstated ${id}.`),
    reject: async (id) => (await verification.reject(id, note ?? '', actor), `Rejected ${id}.`),
    name: async (id) => (await verification.correctName(id, note ?? '', actor), `Legal name corrected for ${id}; ask them to scan their Aadhaar QR again.`),
    'new-photo': async (id) => (await verification.allowNewPhoto(id, actor), `${id} can send a new photo with their next profile submission.`),
    'reissue-qr': async (id) => (await verification.reissueQr(id, actor), `New QR link issued for ${id}.`),
  };
  const action = command ? actions[command] : undefined;
  if (action && target) return [await action(await verification.resolve(target))];
  if ((command === 'approve' || command === 'correct') && target) {
    const id = await verification.resolve(target);
    if (command === 'approve') {
      const { shownFrom } = await verification.approve(id, actor);
      return [`Approved ${id}. The technician sees it from ${shownFrom.toISOString()} (the review time they were given).`];
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
    return { module: CliModule, imports: [ConfigModule.forRoot(config), ClockModule, PrismaModule, CryptoModule, AuditModule, NotifierModule, TechniciansModule] };
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
