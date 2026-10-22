import { Body, Controller, Get, Put } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { type EarningsDto, EarningsService } from './earnings.service';
import { PayoutAccountInput } from './payout-accounts.schemas';
import { type PayoutAccountDto, PayoutAccountsService } from './payout-accounts.service';

/**
 * The signed-in technician's earnings: today, total, the balance waiting for Monday's payout, recent jobs; and where
 * the payout goes (bank account or UPI).
 */
@Controller('tech')
@Roles('TECHNICIAN')
export class EarningsController {
  constructor(
    private readonly earnings: EarningsService,
    private readonly accounts: PayoutAccountsService,
  ) {}

  @Get('earnings')
  get(@CurrentUser() user: AuthUser): Promise<EarningsDto> {
    return this.earnings.summary(user.id);
  }

  /** null until the technician adds their payout details. */
  @Get('payout-account')
  payoutAccount(@CurrentUser() user: AuthUser): Promise<PayoutAccountDto | null> {
    return this.accounts.get(user.id);
  }

  @Put('payout-account')
  setPayoutAccount(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(PayoutAccountInput)) body: PayoutAccountInput): Promise<PayoutAccountDto> {
    return this.accounts.set(user.id, body);
  }
}
