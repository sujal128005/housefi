import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import type { JobDto } from '../bookings/job-view';
import { DispatchService } from './dispatch.service';
import type { JobOfferDto } from './offer-view';

const RejectBody = z
  .object({ reason: z.enum(['TOO_FAR', 'BUSY', 'NOT_MY_SKILL', 'OTHER']).nullable().optional() })
  .optional()
  .transform((b) => b?.reason ?? null);

/** Offers to the signed-in technician. */
@Controller('tech/offers')
@Roles('TECHNICIAN')
export class OffersController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get('current')
  current(@CurrentUser() user: AuthUser): Promise<JobOfferDto | null> {
    return this.dispatch.currentOffer(user.id);
  }

  @Post(':offerId/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('offerId') offerId: string): Promise<JobDto> {
    return this.dispatch.accept(user.id, offerId);
  }

  @Post(':offerId/reject')
  @HttpCode(204)
  async reject(@CurrentUser() user: AuthUser, @Param('offerId') offerId: string, @Body(new ZodValidationPipe(RejectBody)) reason: z.infer<typeof RejectBody>): Promise<void> {
    await this.dispatch.reject(user.id, offerId, reason);
  }
}
