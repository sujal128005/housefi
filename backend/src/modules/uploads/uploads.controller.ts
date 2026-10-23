import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { z } from 'zod';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { AudioTicketBody, DocumentTicketBody, PhotoTicketBody, VideoTicketBody } from './uploads.schemas';
import { type UploadTicketDto, UploadsService } from './uploads.service';

/** Signed URLs for the app to PUT a photo, a voice note, a work video or a certificate straight to the private bucket. */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('photos')
  @HttpCode(200)
  @Roles('CUSTOMER', 'TECHNICIAN', 'COORDINATOR')
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

  /** A technician's work video for the skill check. */
  @Post('videos')
  @HttpCode(200)
  @Roles('TECHNICIAN')
  @RateLimit({ limit: 10, windowSec: 60 })
  video(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(VideoTicketBody)) body: z.infer<typeof VideoTicketBody>): Promise<UploadTicketDto> {
    return this.uploads.ticket({ id: user.id, role: user.role }, 'VIDEO', body);
  }

  /** A technician's certificate (ITI, Skill India…): PDF or photo. */
  @Post('documents')
  @HttpCode(200)
  @Roles('TECHNICIAN')
  @RateLimit({ limit: 10, windowSec: 60 })
  document(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(DocumentTicketBody)) body: z.infer<typeof DocumentTicketBody>): Promise<UploadTicketDto> {
    return this.uploads.ticket({ id: user.id, role: user.role }, 'DOCUMENT', body);
  }
}
