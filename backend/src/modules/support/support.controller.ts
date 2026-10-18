import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { CallbackBody, TicketBody } from './support.schemas';
import { SupportService } from './support.service';

/** Customer care: "call me back" and tickets (the SOS "alert team" is an UNSAFE ticket). */
@Controller('support')
@Roles('CUSTOMER', 'TECHNICIAN')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('callback')
  @HttpCode(201)
  @RateLimit({ limit: 10, windowSec: 600 })
  callback(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(CallbackBody)) body: z.infer<typeof CallbackBody>): Promise<{ ticketId: string }> {
    return this.support.callback({ id: user.id, role: user.role }, body);
  }

  @Post('tickets')
  @HttpCode(201)
  @RateLimit({ limit: 20, windowSec: 600 })
  ticket(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(TicketBody)) body: z.infer<typeof TicketBody>): Promise<{ ticketId: string }> {
    return this.support.raise({ id: user.id, role: user.role }, body);
  }
}
