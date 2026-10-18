import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { streamSse } from '../../common/http/sse';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { BookingCore } from '../bookings/booking-core';
import type { BookingDto } from '../bookings/booking-view';
import type { JobDto } from '../bookings/job-view';
import { LocationBody } from '../technicians/technicians.schemas';
import { TechniciansService } from '../technicians/technicians.service';
import { AnswerBody, QuoteInput, QuoteWhichParam, ReportBody, StartCodeBody } from './jobs.schemas';
import { JobsService } from './jobs.service';

const JobsQuery = z.object({ scope: z.enum(['active', 'past', 'all']).default('all') });

/** The signed-in technician's jobs: reads, live updates and every step of the visit. */
@Controller('tech')
@Roles('TECHNICIAN')
export class JobsController {
  constructor(
    private readonly core: BookingCore,
    private readonly jobs: JobsService,
    private readonly technicians: TechniciansService,
  ) {}

  @Get('jobs')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(JobsQuery)) q: z.infer<typeof JobsQuery>): Promise<JobDto[]> {
    return this.core.listJobs(user.id, q.scope);
  }

  @Get('jobs/:jobId')
  get(@CurrentUser() user: AuthUser, @Param('jobId') id: string): Promise<JobDto> {
    return this.core.getJob(user.id, id);
  }

  /** Live updates (Server-Sent Events): event `job` with the full Job right away and after every change. */
  @Get('jobs/:jobId/stream')
  async stream(@CurrentUser() user: AuthUser, @Param('jobId') id: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const first = await this.core.getJob(user.id, id);
    streamSse(req, reply, { event: 'job', first, reload: () => this.core.getJob(user.id, id), subscribe: (onChange) => this.core.updates.subscribe(id, onChange) });
  }

  @Post('jobs/:jobId/start-trip')
  @HttpCode(200)
  startTrip(@CurrentUser() user: AuthUser, @Param('jobId') id: string): Promise<JobDto> {
    return this.jobs.startTrip(user.id, id);
  }

  @Post('jobs/:jobId/arrived')
  @HttpCode(200)
  arrived(@CurrentUser() user: AuthUser, @Param('jobId') id: string): Promise<JobDto> {
    return this.jobs.arrived(user.id, id);
  }

  @Post('jobs/:jobId/verify-start-code')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  verifyStartCode(@CurrentUser() user: AuthUser, @Param('jobId') id: string, @Body(new ZodValidationPipe(StartCodeBody)) body: z.infer<typeof StartCodeBody>): Promise<JobDto> {
    return this.jobs.verifyStartCode(user.id, id, body.code);
  }

  @Post('jobs/:jobId/quotes')
  @HttpCode(200)
  quote(@CurrentUser() user: AuthUser, @Param('jobId') id: string, @Body(new ZodValidationPipe(QuoteInput)) body: QuoteInput): Promise<JobDto> {
    return this.jobs.submitQuote(user.id, id, body);
  }

  @Post('jobs/:jobId/start-work')
  @HttpCode(200)
  startWork(@CurrentUser() user: AuthUser, @Param('jobId') id: string): Promise<JobDto> {
    return this.jobs.startWork(user.id, id);
  }

  @Post('jobs/:jobId/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('jobId') id: string): Promise<JobDto> {
    return this.jobs.complete(user.id, id);
  }

  @Post('jobs/:jobId/confirm-cash')
  @HttpCode(200)
  confirmCash(@CurrentUser() user: AuthUser, @Param('jobId') id: string): Promise<JobDto> {
    return this.jobs.confirmCash(user.id, id);
  }

  @Post('jobs/:jobId/reports')
  @HttpCode(200)
  report(@CurrentUser() user: AuthUser, @Param('jobId') id: string, @Body(new ZodValidationPipe(ReportBody)) body: z.infer<typeof ReportBody>): Promise<JobDto> {
    return this.jobs.report(user.id, id, body.issue, body.note);
  }

  /** Sent about every 60 s while online or on a job; also refreshes the customer's ETA during the trip. */
  @Post('location')
  @HttpCode(204)
  @RateLimit({ limit: 10, windowSec: 60 })
  async location(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(LocationBody)) body: z.infer<typeof LocationBody>): Promise<void> {
    await this.technicians.updateLocation(user.id, body.lat, body.lng, body.accuracy);
    await this.jobs.refreshEta(user.id);
  }
}

/** The customer's answers to the technician's quotes. */
@Controller('bookings')
@Roles('CUSTOMER')
export class QuoteAnswersController {
  constructor(private readonly jobs: JobsService) {}

  @Post(':bookingId/quotes/:which/answer')
  @HttpCode(200)
  answer(@CurrentUser() user: AuthUser, @Param('bookingId') id: string, @Param('which') which: string, @Body(new ZodValidationPipe(AnswerBody)) body: z.infer<typeof AnswerBody>): Promise<BookingDto> {
    const parsed = QuoteWhichParam.safeParse(which);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    return this.jobs.answerQuote(user.id, id, parsed.data, body.answer);
  }
}
