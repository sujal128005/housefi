import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { ChatBody, ClassifyPhotoBody, TopProblemsQuery, TranscribeBody } from './ai.schemas';
import { CHAT_ASSISTANT, type ChatAssistant, type ChatReplyDto } from './chat';
import { PHOTO_CLASSIFIER, type PhotoClassifier, type PhotoSuggestionDto, SPEECH_TO_TEXT, type SpeechToText } from './models';
import { type LocalTopProblemsDto, TOP_PROBLEMS_RANKER, type TopProblemsRanker } from './top-problems';

/** The customer app's AI features (README §5 "AI"). Rule-based in v1; each one is an interface a model can implement. */
@Controller('ai')
@Roles('CUSTOMER')
export class AiController {
  constructor(
    @Inject(TOP_PROBLEMS_RANKER) private readonly ranker: TopProblemsRanker,
    @Inject(PHOTO_CLASSIFIER) private readonly photos: PhotoClassifier,
    @Inject(SPEECH_TO_TEXT) private readonly speech: SpeechToText,
    @Inject(CHAT_ASSISTANT) private readonly assistant: ChatAssistant,
    private readonly prisma: PrismaService,
  ) {}

  @Get('top-problems')
  topProblems(@Query(new ZodValidationPipe(TopProblemsQuery)) q: z.infer<typeof TopProblemsQuery>): Promise<LocalTopProblemsDto> {
    return this.ranker.rank(q.pincode ?? null);
  }

  @Post('classify-photo')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSec: 60 })
  classify(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ClassifyPhotoBody)) body: z.infer<typeof ClassifyPhotoBody>): Promise<PhotoSuggestionDto> {
    return this.photos.classify({ photoId: body.photoId, customerId: user.id });
  }

  @Post('transcribe')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSec: 60 })
  async transcribe(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(TranscribeBody)) body: z.infer<typeof TranscribeBody>): Promise<{ text: string }> {
    const serviceId = body.serviceId ?? null;
    if (serviceId && !(await this.prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } }))) {
      throw new AppError('VALIDATION', { fields: { serviceId: 'INVALID' } });
    }
    return { text: await this.speech.transcribe({ audioId: body.audioId, customerId: user.id, locale: body.locale, serviceId }) };
  }

  @Post('chat')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 60 })
  chat(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ChatBody)) body: z.infer<typeof ChatBody>): Promise<ChatReplyDto> {
    return this.assistant.reply({ customerId: user.id, message: body.message, locale: body.locale, conversationId: body.conversationId ?? null });
  }
}
