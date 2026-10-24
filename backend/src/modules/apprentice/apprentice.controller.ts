import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import type { BookingDto } from '../bookings/booking-view';
import type { JobDto } from '../bookings/job-view';
import { AddTraineeBody, AnswerBody, ConfirmTraineeBody, MentoringBody, MentorsQuery, RequestBody } from './apprentice.schemas';
import { type ApprenticeOverviewDto, type ApprenticePersonDto, ApprenticeService } from './apprentice.service';

/** Apprentice mode (apprentice.service.ts). */
@Controller()
export class ApprenticeController {
  constructor(private readonly apprentice: ApprenticeService) {}

  @Get('tech/apprentice')
  @Roles('TECHNICIAN')
  @Header('Cache-Control', 'no-store')
  overview(@CurrentUser() user: AuthUser): Promise<ApprenticeOverviewDto> {
    return this.apprentice.overview(user.id);
  }

  @Get('tech/apprentice/mentors')
  @Roles('TECHNICIAN')
  mentors(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(MentorsQuery)) q: z.infer<typeof MentorsQuery>): Promise<ApprenticePersonDto[]> {
    return this.apprentice.mentors(user.id, q.categoryId);
  }

  @Post('tech/apprentice/requests')
  @HttpCode(200)
  @Roles('TECHNICIAN')
  @RateLimit({ limit: 10, windowSec: 3600 })
  request(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(RequestBody)) body: z.infer<typeof RequestBody>): Promise<ApprenticeOverviewDto> {
    return this.apprentice.request(user.id, body.mentorId, body.categoryId);
  }

  @Post('tech/apprentice/requests/:linkId/answer')
  @HttpCode(200)
  @Roles('TECHNICIAN')
  answer(@CurrentUser() user: AuthUser, @Param('linkId') linkId: string, @Body(new ZodValidationPipe(AnswerBody)) body: z.infer<typeof AnswerBody>): Promise<ApprenticeOverviewDto> {
    return this.apprentice.answer(user.id, uuidOr404(linkId), body.accept);
  }

  @Post('tech/apprentice/links/:linkId/end')
  @HttpCode(200)
  @Roles('TECHNICIAN')
  end(@CurrentUser() user: AuthUser, @Param('linkId') linkId: string): Promise<ApprenticeOverviewDto> {
    return this.apprentice.end(user.id, uuidOr404(linkId));
  }

  @Put('tech/apprentice/mentoring')
  @Roles('TECHNICIAN')
  mentoring(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(MentoringBody)) body: z.infer<typeof MentoringBody>): Promise<ApprenticeOverviewDto> {
    return this.apprentice.setMentoring(user.id, body.open);
  }

  @Post('tech/jobs/:jobId/trainee')
  @HttpCode(200)
  @Roles('TECHNICIAN')
  addTrainee(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string, @Body(new ZodValidationPipe(AddTraineeBody)) body: z.infer<typeof AddTraineeBody>): Promise<JobDto> {
    return this.apprentice.addTrainee(user.id, jobId, body.apprenticeId);
  }

  @Delete('tech/jobs/:jobId/trainee')
  @Roles('TECHNICIAN')
  removeTrainee(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string): Promise<JobDto> {
    return this.apprentice.removeTrainee(user.id, jobId);
  }

  @Post('tech/jobs/:jobId/trainee/confirm')
  @HttpCode(200)
  @Roles('TECHNICIAN')
  confirmTrainee(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string, @Body(new ZodValidationPipe(ConfirmTraineeBody)) body: z.infer<typeof ConfirmTraineeBody>): Promise<JobDto> {
    return this.apprentice.confirmTrainee(user.id, jobId, body.helped);
  }

  @Post('bookings/:bookingId/trainee/decline')
  @HttpCode(200)
  @Roles('CUSTOMER')
  decline(@CurrentUser() user: AuthUser, @Param('bookingId') bookingId: string): Promise<BookingDto> {
    return this.apprentice.decline(user.id, bookingId);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOr404(id: string): string {
  if (!UUID.test(id)) throw new AppError('NOT_FOUND');
  return id;
}
