import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { DeviceBody, MarkReadBody } from './notifications.schemas';
import { type NotificationDto, NotificationsService } from './notifications.service';

/** The inbox and push-token registration, for customers and technicians (staff accounts have neither). */
@Controller()
@Roles('CUSTOMER', 'TECHNICIAN')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@CurrentUser() user: AuthUser): Promise<NotificationDto[]> {
    return this.notifications.list(user.id);
  }

  @Post('notifications/read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(MarkReadBody)) body: z.infer<typeof MarkReadBody>): Promise<void> {
    await this.notifications.markRead(user.id, body.ids);
  }

  @Post('devices')
  @HttpCode(204)
  async device(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(DeviceBody)) body: z.infer<typeof DeviceBody>): Promise<void> {
    await this.notifications.registerDevice(user.id, user.sessionId, body.pushToken, body.platform);
  }
}
