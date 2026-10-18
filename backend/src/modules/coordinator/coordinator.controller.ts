import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import type { JobDto } from '../bookings/job-view';
import { TechProfileInput } from '../technicians/technicians.schemas';
import { type TechProfileDto, TechniciansService } from '../technicians/technicians.service';
import { type CoordinatorJobsDto, CoordinatorService, type OfferHistoryDto, type QueueEntryDto } from './coordinator.service';

const AssignBody = z.object({ technicianId: z.string().min(1).max(64) }).strict();
/** A technician without a smartphone, registered by their coordinator (the profile fields plus their number). */
const RegisterBody = TechProfileInput.extend({ phone: z.string().regex(/^[6-9][0-9]{9}$/), phoneType: z.enum(['KEYPAD', 'NONE']) });

/** Coordinator-assisted jobs (API only in v1; the coordinator portal comes later). */
@Controller('coordinator')
@Roles('COORDINATOR')
export class CoordinatorController {
  constructor(
    private readonly coordinator: CoordinatorService,
    private readonly technicians: TechniciansService,
  ) {}

  /** Registers a keypad-phone (or no-phone) technician, linked to this coordinator; verification as usual. */
  @Post('technicians')
  @HttpCode(201)
  register(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(RegisterBody)) body: z.infer<typeof RegisterBody>): Promise<TechProfileDto> {
    const { phone, phoneType, ...profile } = body;
    return this.technicians.registerForCoordinator(user.id, phone, profile, phoneType);
  }

  /** An addition to the contract: what is waiting for a technician, and the jobs of this coordinator's technicians. */
  @Get('jobs')
  list(@CurrentUser() user: AuthUser): Promise<CoordinatorJobsDto> {
    return this.coordinator.list(user.id);
  }

  /** Bookings no app or phone technician took: one coordinator claims one, calls a technician, then assigns. */
  @Get('dispatch-queue')
  queue(@CurrentUser() user: AuthUser): Promise<QueueEntryDto[]> {
    return this.coordinator.queue(user.id);
  }

  @Post('dispatch-queue/:bookingId/claim')
  @HttpCode(204)
  async claim(@CurrentUser() user: AuthUser, @Param('bookingId') id: string): Promise<void> {
    await this.coordinator.claim(user.id, id);
  }

  @Post('dispatch-queue/:bookingId/release')
  @HttpCode(204)
  async release(@CurrentUser() user: AuthUser, @Param('bookingId') id: string): Promise<void> {
    await this.coordinator.release(user.id, id);
  }

  @Get('jobs/:jobId/offers')
  offers(@CurrentUser() user: AuthUser, @Param('jobId') id: string): Promise<OfferHistoryDto[]> {
    return this.coordinator.offers(user.id, id);
  }

  @Post('jobs/:jobId/assign')
  @HttpCode(200)
  assign(@CurrentUser() user: AuthUser, @Param('jobId') id: string, @Body(new ZodValidationPipe(AssignBody)) body: z.infer<typeof AssignBody>): Promise<JobDto> {
    return this.coordinator.assign(user.id, id, body.technicianId);
  }

  /** Same body as the technician's endpoint for that action (validated per action). */
  @Post('jobs/:jobId/actions/:action')
  @HttpCode(200)
  act(@CurrentUser() user: AuthUser, @Param('jobId') id: string, @Param('action') action: string, @Body() body: unknown): Promise<JobDto> {
    return this.coordinator.act(user.id, id, action, body ?? {});
  }
}
