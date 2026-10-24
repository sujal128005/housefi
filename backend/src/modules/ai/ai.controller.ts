import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.module';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { UploadsService } from '../uploads/uploads.service';
import { ChatBody, CheckQuoteBody, ClassifyPhotoBody, ReadQuoteBody, TopProblemsQuery, TranscribeBody } from './ai.schemas';
import { CHAT_ASSISTANT, type ChatAssistant, type ChatReplyDto } from './chat';
import { PHOTO_CLASSIFIER, type PhotoClassifier, type PhotoSuggestionDto, SPEECH_TO_TEXT, type SpeechToText } from './models';
import { compareQuote, QUOTE_READER, type QuoteCheckDto, type QuoteReadDto, type QuoteReader } from './quote-check';
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
    @Inject(QUOTE_READER) private readonly quotes: QuoteReader,
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  @Get('top-problems')
  topProblems(@Query(new ZodValidationPipe(TopProblemsQuery)) q: z.infer<typeof TopProblemsQuery>): Promise<LocalTopProblemsDto> {
    return this.ranker.rank(q.pincode ?? null);
  }

  @Post('classify-photo')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSec: 60 })
  async classify(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ClassifyPhotoBody)) body: z.infer<typeof ClassifyPhotoBody>): Promise<PhotoSuggestionDto> {
    await this.uploads.ready(user.id, [body.photoId], 'PHOTO', 'photoId', 'PROBLEM');
    return this.photos.classify({ photoId: body.photoId, customerId: user.id });
  }

  /** Quote checker, step 1: a model reads the photographed quote into lines (readable false: the customer types them). */
  @Post('read-quote')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 3600 })
  async readQuote(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ReadQuoteBody)) body: z.infer<typeof ReadQuoteBody>): Promise<QuoteReadDto> {
    await this.uploads.ready(user.id, [body.photoId], 'PHOTO', 'photoId', 'PROBLEM');
    return this.quotes.read({ photoId: body.photoId, customerId: user.id });
  }

  /** Quote checker, step 2: the confirmed lines against Housefi's usual price and price list (rules only). */
  @Post('check-quote')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 3600 })
  async checkQuote(@Body(new ZodValidationPipe(CheckQuoteBody)) body: z.infer<typeof CheckQuoteBody>): Promise<QuoteCheckDto> {
    const service = await this.prisma.service.findFirst({ where: { id: body.serviceId, active: true }, select: { visitFeePaise: true, repairFromPaise: true, repairTypicalMaxPaise: true } });
    if (!service) throw new AppError('VALIDATION', { fields: { serviceId: 'INVALID' } });
    const partIds = [...new Set(body.lines.flatMap((l) => (l.partId ? [l.partId] : [])))];
    const parts = partIds.length ? await this.prisma.part.findMany({ where: { id: { in: partIds }, active: true }, select: { id: true, pricePaise: true } }) : [];
    const lines = body.lines.map((l) => ({ name: l.name, kind: l.kind, qty: l.qty, amount: l.amount, partId: l.partId ?? null }));
    return compareQuote(body.serviceId, service, lines, new Map(parts.map((p) => [p.id, p.pricePaise])));
  }

  @Post('transcribe')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSec: 60 })
  async transcribe(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(TranscribeBody)) body: z.infer<typeof TranscribeBody>): Promise<{ text: string }> {
    const serviceId = body.serviceId ?? null;
    if (serviceId && !(await this.prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } }))) {
      throw new AppError('VALIDATION', { fields: { serviceId: 'INVALID' } });
    }
    await this.uploads.ready(user.id, [body.audioId], 'AUDIO', 'audioId');
    return { text: await this.speech.transcribe({ audioId: body.audioId, customerId: user.id, locale: body.locale, serviceId }) };
  }

  @Post('chat')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 60 })
  chat(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ChatBody)) body: z.infer<typeof ChatBody>): Promise<ChatReplyDto> {
    return this.assistant.reply({ customerId: user.id, message: body.message, locale: body.locale, conversationId: body.conversationId ?? null });
  }
}
