import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { AvailabilityBody, TechProfileInput } from './technicians.schemas';
import { type TechProfileDto, TechniciansService } from './technicians.service';

/** The signed-in technician's own profile and availability (location updates live with the jobs API). */
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
}
