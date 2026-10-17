import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import type { JobDto } from '../bookings/job-view';
import { type CoordinatorJobsDto, CoordinatorService } from './coordinator.service';

const AssignBody = z.object({ technicianId: z.string().min(1).max(64) }).strict();

/** Coordinator-assisted jobs (API only in v1; the coordinator portal comes later). */
@Controller('coordinator')
@Roles('COORDINATOR')
export class CoordinatorController {
  constructor(private readonly coordinator: CoordinatorService) {}

  /** An addition to the contract: what is waiting for a technician, and the jobs of this coordinator's technicians. */
  @Get('jobs')
  list(@CurrentUser() user: AuthUser): Promise<CoordinatorJobsDto> {
    return this.coordinator.list(user.id);
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
