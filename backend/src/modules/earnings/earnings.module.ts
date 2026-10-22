import { Module } from '@nestjs/common';
import { EarningsController } from './earnings.controller';
import { EarningsService } from './earnings.service';
import { PayoutAccountsService } from './payout-accounts.service';

/**
 * Reads the ledger and runs payouts; keeps where payouts go and makes the bank files (payout-accounts.service.ts). Ledger rows are written by BookingCore.transition (ledger.ts), so this module
 * depends only on global infrastructure and the CLI can load it without the API.
 */
@Module({ controllers: [EarningsController], providers: [EarningsService, PayoutAccountsService], exports: [EarningsService, PayoutAccountsService] })
export class EarningsModule {}
