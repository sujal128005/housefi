// Where weekly payouts go, and the bank files to send them.
// - The technician enters a bank account (number + IFSC) or a UPI ID in the app (Profile -> Payout details). The
//   number, UPI ID and holder name are encrypted; only a masked hint is readable (and shown back).
// - Every Monday, after "Prepare payouts", HQ downloads the bulk-transfer files for the bank (payout kit, built with
//   IBM Bob: payout-kit/). Payouts without details, or with details the kit refuses, are left out and listed.
//   Details changed in the last 48 hours are flagged: a changed account is how payout fraud usually starts, so the
//   person paying confirms it with the technician by phone first.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.module';
import { type Clock, InjectClock } from '../../common/clock';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { buildBankFiles } from './payout-kit/bank-file';
import { maskAccount, maskUpi } from './payout-kit/format';
import { payoutSummary } from './payout-kit/summary';
import type { KitPayout, ValidationError } from './payout-kit/types';
import { validateBatch, validatePayout } from './payout-kit/validate';
import type { PayoutAccountInput } from './payout-accounts.schemas';

/** Details changed more recently than this are flagged in the bank-file summary. */
export const RECENT_CHANGE_MS = 48 * 3_600_000;

export interface PayoutAccountDto {
  readonly rail: 'BANK' | 'UPI';
  readonly holderName: string;
  /** Masked: XXXXXX1234 · SBIN0001234, or r*****@okicici. */
  readonly hint: string;
  readonly updatedAt: number;
}

export interface BankFilesDto {
  /** The latest week the payouts cover (a Sunday), in the file names. */
  readonly weekEnding: string | null;
  readonly files: readonly { readonly filename: string; readonly rail: 'BANK' | 'UPI'; readonly count: number; readonly amount: number; readonly content: string }[];
  /** Payouts left out, with plain reasons, for the person paying to sort out first. */
  readonly skipped: readonly { readonly payoutId: string; readonly technicianName: string; readonly problems: readonly string[] }[];
  readonly warnings: readonly string[];
  readonly summary: string;
}

const hintFor = (p: KitPayout) => (p.rail === 'BANK' ? `${maskAccount(p.accountNumber)} · ${p.ifsc}` : maskUpi(p.upiId));

@Injectable()
export class PayoutAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly audit: AuditService,
    @InjectClock() private readonly clock: Clock,
  ) {}

  async get(technicianId: string): Promise<PayoutAccountDto | null> {
    const a = await this.prisma.technicianPayoutAccount.findUnique({ where: { technicianId } });
    if (!a) return null;
    return { rail: a.rail, holderName: await this.cipher.decrypt('payout_accounts.holder_name', a.holderNameEnc), hint: a.hint, updatedAt: a.updatedAt.getTime() };
  }

  /** Saves the technician's payout details after the payout kit's checks (VALIDATION names the wrong fields). */
  async set(technicianId: string, input: PayoutAccountInput): Promise<PayoutAccountDto> {
    const tech = await this.prisma.technician.findUnique({ where: { userId: technicianId }, select: { userId: true } });
    if (!tech) throw new AppError('NOT_FOUND', {}, 'no technician profile');
    // Every field goes to the check, so a bank number sent with a UPI ID (or the other way round) is refused.
    const draft: KitPayout = { id: 'check', holderName: input.holderName, amountPaise: 1, rail: input.rail, accountNumber: input.accountNumber, ifsc: input.ifsc, upiId: input.upiId, weekEnding: '2026-01-04' };
    const checked = validatePayout(draft);
    if (!checked.ok || !checked.clean) {
      const fields = Object.fromEntries(checked.errors.map((e) => [e.field, 'INVALID' as const]));
      throw new AppError('VALIDATION', { fields }, 'payout details are not valid');
    }
    const c = checked.clean;
    const now = new Date(this.clock.now());
    const data = {
      rail: c.rail,
      holderNameEnc: await this.cipher.encrypt('payout_accounts.holder_name', c.holderName),
      accountNumberEnc: c.rail === 'BANK' ? await this.cipher.encrypt('payout_accounts.account_number', c.accountNumber ?? '') : null,
      ifsc: c.rail === 'BANK' ? (c.ifsc ?? null) : null,
      upiIdEnc: c.rail === 'UPI' ? await this.cipher.encrypt('payout_accounts.upi_id', c.upiId ?? '') : null,
      hint: hintFor(c),
      updatedAt: now,
    };
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.technicianPayoutAccount.findUnique({ where: { technicianId }, select: { rail: true, hint: true } });
      await tx.technicianPayoutAccount.upsert({ where: { technicianId }, create: { technicianId, ...data }, update: data });
      await this.audit.record({
        actorType: 'TECHNICIAN', actorId: technicianId, action: 'payout_account.set', entity: 'technician', entityId: technicianId,
        after: { rail: data.rail, hint: data.hint }, ...(before ? { before: { rail: before.rail, hint: before.hint } } : {}),
      }, tx);
    });
    return (await this.get(technicianId))!;
  }

  /** The bank files for every payout waiting to be paid (HQ, after "Prepare payouts"). Audited, with counts only. */
  async bankFiles(actor: { readonly id: string | null; readonly via: string }): Promise<BankFilesDto> {
    const payouts = await this.prisma.payout.findMany({
      where: { state: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { technician: { select: { payoutAccount: true, user: { select: { nameEnc: true } } } } },
    });
    const now = this.clock.now();
    const names = new Map<string, string>();
    const missing: BankFilesDto['skipped'][number][] = [];
    const recent: string[] = [];
    const kit: KitPayout[] = [];
    for (const p of payouts) {
      const name = p.technician.user.nameEnc ? await this.cipher.decrypt('users.name', p.technician.user.nameEnc) : 'Technician';
      names.set(p.id, name);
      const a = p.technician.payoutAccount;
      if (!a) {
        missing.push({ payoutId: p.id, technicianName: name, problems: ['No payout details yet: ask them to add them in the app (Profile -> Payout details)'] });
        continue;
      }
      if (now - a.updatedAt.getTime() < RECENT_CHANGE_MS) {
        recent.push(`${name} changed their payout details on ${a.updatedAt.toISOString().slice(0, 10)} (${a.hint}): confirm with them by phone before paying`);
      }
      const base = { id: p.id, holderName: await this.cipher.decrypt('payout_accounts.holder_name', a.holderNameEnc), amountPaise: Number(p.amountPaise), weekEnding: p.periodEnd.toISOString().slice(0, 10) };
      kit.push(a.rail === 'BANK'
        ? { ...base, rail: 'BANK', accountNumber: await this.cipher.decrypt('payout_accounts.account_number', a.accountNumberEnc!), ifsc: a.ifsc?.trim() ?? '' }
        : { ...base, rail: 'UPI', upiId: await this.cipher.decrypt('payout_accounts.upi_id', a.upiIdEnc!) });
    }

    const weekEnding = payouts.length ? payouts.map((p) => p.periodEnd.toISOString().slice(0, 10)).sort().at(-1)! : null;
    const batch = validateBatch(kit);
    const built = buildBankFiles(batch, weekEnding ?? 'none');
    const problems = (errors: readonly ValidationError[]) => errors.map((e) => e.message);
    const skipped = [...missing, ...built.skipped.map((s) => ({ payoutId: s.id, technicianName: names.get(s.id) ?? '', problems: problems(s.errors) }))];
    const warnings = [...recent, ...batch.warnings];
    const summary = [
      payoutSummary(batch, built, names),
      ...(missing.length ? ['NO PAYOUT DETAILS:', ...missing.map((m) => `- ${m.technicianName}`), ''] : []),
      ...(recent.length ? ['RECENTLY CHANGED:', ...recent.map((r) => `- ${r}`), ''] : []),
    ].join('\n');

    await this.audit.record({
      actorType: 'ADMIN', actorId: actor.id, action: 'payouts.bank_files', entity: 'payout', entityId: weekEnding ?? 'none',
      after: { payouts: payouts.length, inFiles: batch.totals.valid, skipped: skipped.length, warnings: warnings.length, via: actor.via },
    });
    return {
      weekEnding,
      files: built.files.map((f) => ({ filename: f.filename, rail: f.rail, count: f.count, amount: f.totalPaise / 100, content: f.content })),
      skipped,
      warnings,
      summary,
    };
  }
}
