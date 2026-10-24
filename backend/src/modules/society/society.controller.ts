import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { VisitWindow } from '../bookings/bookings.schemas';
import { CATEGORY_ORDER } from '../technicians/technicians.schemas';
import { type SocietyDayDto, SocietyService } from './society.service';

/** openapi.yaml NewSocietyDay. */
const NewSocietyDay = z
  .object({
    name: z.string().trim().min(2).max(60),
    categoryId: z.enum(CATEGORY_ORDER),
    addressId: z.string().max(64),
    window: VisitWindow,
  })
  .strict();

/** Society repair day (society.service.ts). Neighbours join by booking their flat with the code (POST /bookings). */
@Controller('society-days')
@Roles('CUSTOMER')
export class SocietyController {
  constructor(private readonly society: SocietyService) {}

  @Post()
  @RateLimit({ limit: 5, windowSec: 3600 })
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(NewSocietyDay)) body: z.infer<typeof NewSocietyDay>): Promise<SocietyDayDto> {
    return this.society.create(user.id, body);
  }

  @Get()
  mine(@CurrentUser() user: AuthUser): Promise<SocietyDayDto[]> {
    return this.society.mine(user.id);
  }

  @Get(':code')
  @RateLimit({ limit: 60, windowSec: 3600 })
  get(@CurrentUser() user: AuthUser, @Param('code') code: string): Promise<SocietyDayDto> {
    return this.society.get(user.id, code);
  }
}
