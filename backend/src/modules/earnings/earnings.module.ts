import { Module } from '@nestjs/common';
import { EarningsController } from './earnings.controller';
import { EarningsService } from './earnings.service';

/**
 * Reads the ledger and runs payouts. Ledger rows are written by BookingCore.transition (ledger.ts), so this module
 * depends only on global infrastructure and the CLI can load it without the API.
 */
@Module({ controllers: [EarningsController], providers: [EarningsService], exports: [EarningsService] })
export class EarningsModule {}
