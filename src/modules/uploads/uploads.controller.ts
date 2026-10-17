import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { AudioTicketBody, PhotoTicketBody } from './uploads.schemas';
import { type UploadTicketDto, UploadsService } from './uploads.service';

/** Signed URLs for the app to PUT a photo or a voice note straight to the private bucket. */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('photos')
  @HttpCode(200)
  @Roles('CUSTOMER', 'TECHNICIAN')
  @RateLimit({ limit: 30, windowSec: 60 })
  photo(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(PhotoTicketBody)) body: z.infer<typeof PhotoTicketBody>): Promise<UploadTicketDto> {
    return this.uploads.ticket({ id: user.id, role: user.role }, 'PHOTO', body);
  }

  @Post('audio')
  @HttpCode(200)
  @Roles('CUSTOMER')
  @RateLimit({ limit: 30, windowSec: 60 })
  audio(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(AudioTicketBody)) body: z.infer<typeof AudioTicketBody>): Promise<UploadTicketDto> {
    return this.uploads.ticket({ id: user.id, role: user.role }, 'AUDIO', body);
  }
}
