import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { type SupportConversationDto, SupportChatService } from './support-chat.service';
import { CallbackBody, ConversationMessageBody, ConversationStartBody, TicketBody } from './support.schemas';
import { SupportService } from './support.service';

/** Customer care: "call me back" and tickets (the SOS "alert team" is an UNSAFE ticket). */
@Controller('support')
@Roles('CUSTOMER', 'TECHNICIAN')
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly chat: SupportChatService,
  ) {}

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

  /** The live conversation with the Housefi team: the open one (or one closed in the last day), or null. */
  @Get('conversation')
  async conversation(@CurrentUser() user: AuthUser): Promise<{ conversation: SupportConversationDto | null }> {
    return { conversation: await this.chat.current({ id: user.id, role: user.role }) };
  }

  @Post('conversation')
  @HttpCode(201)
  @RateLimit({ limit: 10, windowSec: 600 })
  async startConversation(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ConversationStartBody)) body: z.infer<typeof ConversationStartBody>): Promise<{ conversation: SupportConversationDto }> {
    return { conversation: await this.chat.start({ id: user.id, role: user.role }, body) };
  }

  @Post('conversation/messages')
  @HttpCode(200)
  @RateLimit({ limit: 40, windowSec: 600 })
  async message(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ConversationMessageBody)) body: z.infer<typeof ConversationMessageBody>): Promise<{ conversation: SupportConversationDto }> {
    return { conversation: await this.chat.send({ id: user.id, role: user.role }, body.text) };
  }
}
