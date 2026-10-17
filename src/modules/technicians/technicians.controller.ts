import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { AvailabilityBody, LocationBody, TechProfileInput } from './technicians.schemas';
import { type TechProfileDto, TechniciansService } from './technicians.service';

/** The signed-in technician's own profile, availability and location. */
@Controller('tech')
@Roles('TECHNICIAN')
export class TechniciansController {
  constructor(private readonly technicians: TechniciansService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<TechProfileDto> {
    return this.technicians.me(user.id);
  }

  @Put('profile')
  submit(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(TechProfileInput)) input: TechProfileInput): Promise<TechProfileDto> {
    return this.technicians.submit(user.id, input);
  }

  @Post('availability')
  @HttpCode(200)
  availability(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(AvailabilityBody)) body: z.infer<typeof AvailabilityBody>): Promise<TechProfileDto> {
    return this.technicians.setOnline(user.id, body.online);
  }

  /** Sent about every 60 s; the limit leaves room for retries and a few app restarts. */
  @Post('location')
  @HttpCode(204)
  @RateLimit({ limit: 10, windowSec: 60 })
  async location(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(LocationBody)) body: z.infer<typeof LocationBody>): Promise<void> {
    await this.technicians.updateLocation(user.id, body.lat, body.lng, body.accuracy);
  }
}
