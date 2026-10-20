import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { CHAT_TEXT_MAX, type ChatDto, ChatService, type ChatSummaryDto } from './chat.service';

export const ChatMessageInput = z
  .object({
    text: z.string().max(CHAT_TEXT_MAX).default(''),
    photoUploadId: z.string().max(64).optional(),
  })
  .strict();
type ChatMessageInput = z.infer<typeof ChatMessageInput>;

/** Chat between a customer and the assigned technician (openapi.yaml, tag chat). */
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  // ---------- customer ----------

  @Get('chats')
  @Roles('CUSTOMER')
  customerChats(@CurrentUser() user: AuthUser): Promise<ChatSummaryDto[]> {
    return this.chat.mine(user.id, 'CUSTOMER');
  }

  @Get('bookings/:bookingId/chat')
  @Roles('CUSTOMER')
  customerChat(@CurrentUser() user: AuthUser, @Param('bookingId') id: string): Promise<ChatDto> {
    return this.chat.get(user.id, 'CUSTOMER', id);
  }

  @Post('bookings/:bookingId/chat')
  @Roles('CUSTOMER')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  customerSend(@CurrentUser() user: AuthUser, @Param('bookingId') id: string, @Body(new ZodValidationPipe(ChatMessageInput)) input: ChatMessageInput): Promise<ChatDto> {
    return this.chat.send(user.id, 'CUSTOMER', id, input);
  }

  @Delete('bookings/:bookingId/chat')
  @Roles('CUSTOMER')
  @HttpCode(204)
  async customerClear(@CurrentUser() user: AuthUser, @Param('bookingId') id: string): Promise<void> {
    await this.chat.clear(user.id, 'CUSTOMER', id);
  }

  // ---------- technician ----------

  @Get('tech/chats')
  @Roles('TECHNICIAN')
  techChats(@CurrentUser() user: AuthUser): Promise<ChatSummaryDto[]> {
    return this.chat.mine(user.id, 'TECHNICIAN');
  }

  @Get('tech/jobs/:jobId/chat')
  @Roles('TECHNICIAN')
  techChat(@CurrentUser() user: AuthUser, @Param('jobId') id: string): Promise<ChatDto> {
    return this.chat.get(user.id, 'TECHNICIAN', id);
  }

  @Post('tech/jobs/:jobId/chat')
  @Roles('TECHNICIAN')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  techSend(@CurrentUser() user: AuthUser, @Param('jobId') id: string, @Body(new ZodValidationPipe(ChatMessageInput)) input: ChatMessageInput): Promise<ChatDto> {
    return this.chat.send(user.id, 'TECHNICIAN', id, input);
  }

  @Delete('tech/jobs/:jobId/chat')
  @Roles('TECHNICIAN')
  @HttpCode(204)
  async techClear(@CurrentUser() user: AuthUser, @Param('jobId') id: string): Promise<void> {
    await this.chat.clear(user.id, 'TECHNICIAN', id);
  }
}
