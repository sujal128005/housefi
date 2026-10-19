// `npm run admin -- <command>` (on the laptop server: deploy\laptop admin <command>): the super admin accounts. There is
// no sign-up anywhere: accounts exist only when created here, on the server.
//   create "<name>" <phone>        a new super admin: prints the official username and a generated password ONCE (put
//                                  both in the password manager; they are never shown again)
//   list                           accounts, whether a passkey is registered, locks
//   reset-password <username>      a new generated password (printed once); signs out every session
//   reset-passkeys <username>      forgets the passkeys: the next sign-in registers one again (a new laptop)
//   unlock <username>              lifts a lock after wrong passwords
//   disable <username> / enable <username>
// Every change is in audit_log with who ran it.
import { type DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { AuditModule, AuditService } from '../common/audit/audit.module';
import { type Clock, CLOCK, ClockModule } from '../common/clock';
import { CryptoModule } from '../common/crypto/crypto.module';
import { FieldCipher } from '../common/crypto/field-cipher';
import { Hashing } from '../common/crypto/hashing';
import { AppError } from '../common/errors/app-error';
import { PrismaModule, PrismaService } from '../common/prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { parseEnv, type Env } from '../config/env';
import { generatePassword, generateUsername, hashPassword } from '../modules/admin/admin-password';

export const USAGE = [
  'usage: npm run admin -- <command>   (laptop: deploy\\laptop admin <command>)',
  '  create "<name>" <phone>     new super admin: prints the username and password once',
  '  list                        the accounts',
  '  reset-password <username>   a new password (printed once); signs out everywhere',
  '  reset-passkeys <username>   register the face / fingerprint again at the next sign-in',
  '  unlock <username>           lift a lock after wrong passwords',
  '  disable <username>          no sign-in until enabled',
  '  enable <username>',
].join('\n');

/** At most two super admins for now (the founders). */
export const MAX_ADMINS = 2;

export interface AdminCliDeps {
  readonly prisma: PrismaService;
  readonly cipher: FieldCipher;
  readonly hashing: Hashing;
  readonly audit: AuditService;
  readonly clock: Clock;
  readonly via: string;
}

export async function runAdminCommand(args: readonly string[], d: AdminCliDeps): Promise<string[]> {
  const [command, a, b] = args;
  const now = () => new Date(d.clock.now());
  const log = (action: string, entityId: string, after: Record<string, string> = {}) =>
    d.audit.record({ actorType: 'ADMIN', actorId: null, action, entity: 'admin', entityId, after: { ...after, via: d.via } });
  const find = async (username: string | undefined) => {
    const admin = username ? await d.prisma.adminUser.findUnique({ where: { username: username.trim().toLowerCase() } }) : null;
    if (!admin) throw new AppError('NOT_FOUND', {}, 'no such admin username');
    return admin;
  };

  if (command === 'create' && a && b) {
    const phone = b.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(phone)) return ['The phone must be a 10-digit Indian mobile number.'];
    if ((await d.prisma.adminUser.count()) >= MAX_ADMINS) return [`There are already ${MAX_ADMINS} super admins.`];
    const username = generateUsername(a);
    const password = generatePassword();
    const admin = await d.prisma.adminUser.create({
      data: {
        username,
        displayName: a.trim().slice(0, 60),
        passwordHash: await hashPassword(password),
        phoneEnc: await d.cipher.encrypt('admin_users.phone', phone),
        phoneHash: d.hashing.phone(phone),
        passwordChangedAt: now(),
        createdAt: now(),
      },
    });
    await log('admin.created', admin.id);
    return [
      `Super admin created for ${admin.displayName}.`,
      `  username: ${username}`,
      `  password: ${password}`,
      'Save both in the password manager now: they are not shown again. The first sign-in registers the face / fingerprint.',
    ];
  }
  if (command === 'list') {
    const rows = await d.prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { passkeys: true } } } });
    if (rows.length === 0) return ['No super admins yet: npm run admin -- create "<name>" <phone>'];
    return rows.map((r) => `${r.username}  ${r.displayName}  passkeys: ${r._count.passkeys}  ${r.disabledAt ? 'DISABLED' : r.lockedUntil && r.lockedUntil > now() ? `locked until ${r.lockedUntil.toISOString()}` : 'active'}  last sign-in: ${r.lastLoginAt?.toISOString() ?? 'never'}`);
  }
  if (command === 'reset-password' && a) {
    const admin = await find(a);
    const password = generatePassword();
    await d.prisma.$transaction([
      d.prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(password), passwordChangedAt: now(), failedLogins: 0, lockedUntil: null } }),
      d.prisma.adminSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: now() } }),
    ]);
    await log('admin.password_reset', admin.id);
    return [`New password for ${admin.username}: ${password}`, 'Save it in the password manager now. Every session was signed out.'];
  }
  if (command === 'reset-passkeys' && a) {
    const admin = await find(a);
    const n = await d.prisma.adminPasskey.deleteMany({ where: { adminId: admin.id } });
    await d.prisma.adminSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: now() } });
    await log('admin.passkeys_reset', admin.id, { removed: String(n.count) });
    return [`Removed ${n.count} passkey(s) of ${admin.username}. The next sign-in registers the face / fingerprint again.`];
  }
  if (command === 'unlock' && a) {
    const admin = await find(a);
    await d.prisma.adminUser.update({ where: { id: admin.id }, data: { failedLogins: 0, lockedUntil: null } });
    await log('admin.unlocked', admin.id);
    return [`Unlocked ${admin.username}.`];
  }
  if ((command === 'disable' || command === 'enable') && a) {
    const admin = await find(a);
    await d.prisma.adminUser.update({ where: { id: admin.id }, data: { disabledAt: command === 'disable' ? now() : null } });
    if (command === 'disable') await d.prisma.adminSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: now() } });
    await log(`admin.${command}d`, admin.id);
    return [`${command === 'disable' ? 'Disabled' : 'Enabled'} ${admin.username}.`];
  }
  return [USAGE];
}

@Module({})
class CliModule {
  static forRoot(config: Env): DynamicModule {
    return { module: CliModule, imports: [ConfigModule.forRoot(config), ClockModule, PrismaModule, CryptoModule, AuditModule] };
  }
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = parseEnv(process.env);
  const app = await NestFactory.createApplicationContext(CliModule.forRoot(config), { logger: ['error'] });
  try {
    const lines = await runAdminCommand(process.argv.slice(2), {
      prisma: app.get(PrismaService),
      cipher: app.get(FieldCipher),
      hashing: app.get(Hashing),
      audit: app.get(AuditService),
      clock: app.get<Clock>(CLOCK),
      via: `cli:${userInfo().username}`,
    });
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (err) {
    process.stderr.write(`${err instanceof AppError ? `${err.code}: ${err.message}` : (err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) void main();
