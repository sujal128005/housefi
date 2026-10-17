import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { streamSse } from '../../common/http/sse';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { BookingCore } from '../bookings/booking-core';
import type { JobDto } from '../bookings/job-view';
import { DispatchService } from './dispatch.service';
import type { JobOfferDto } from './offer-view';

const RejectBody = z
  .object({ reason: z.enum(['TOO_FAR', 'BUSY', 'NOT_MY_SKILL', 'OTHER']).nullable().optional() })
  .optional()
  .transform((b) => b?.reason ?? null);

const JobsQuery = z.object({ scope: z.enum(['active', 'past', 'all']).default('all') });

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

/** Jobs assigned to the signed-in technician (reads; the job actions arrive in step 9). */
@Controller('tech/jobs')
@Roles('TECHNICIAN')
export class JobsController {
  constructor(private readonly core: BookingCore) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(JobsQuery)) q: z.infer<typeof JobsQuery>): Promise<JobDto[]> {
    return this.core.listJobs(user.id, q.scope);
  }

  @Get(':jobId')
  get(@CurrentUser() user: AuthUser, @Param('jobId') id: string): Promise<JobDto> {
    return this.core.getJob(user.id, id);
  }

  /** Live updates (Server-Sent Events): event `job` with the full Job right away and after every change. */
  @Get(':jobId/stream')
  async stream(@CurrentUser() user: AuthUser, @Param('jobId') id: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const first = await this.core.getJob(user.id, id);
    streamSse(req, reply, {
      event: 'job',
      first,
      reload: () => this.core.getJob(user.id, id),
      subscribe: (onChange) => this.core.updates.subscribe(id, onChange),
    });
  }
}
