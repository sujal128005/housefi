import { Controller, Get } from '@nestjs/common';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { type EarningsDto, EarningsService } from './earnings.service';

/** The signed-in technician's earnings: today, total, the balance waiting for Monday's payout, recent jobs. */
@Controller('tech')
@Roles('TECHNICIAN')
export class EarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get('earnings')
  get(@CurrentUser() user: AuthUser): Promise<EarningsDto> {
    return this.earnings.summary(user.id);
  }
}
