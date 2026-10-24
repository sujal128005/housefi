import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { AiController } from './ai.controller';
import { CHAT_ASSISTANT, RuleBasedChat } from './chat';
import { ANTHROPIC_CLIENT, ChatMemory, ClaudeChat, ClaudePhotoClassifier, ClaudeQuoteReader, createAnthropic } from './claude';
import { CLOUDFLARE_AI_FETCH, CloudflareChat, CloudflarePhotoClassifier, CloudflareQuoteReader, WorkersAi } from './cloudflare';
import { FREE_CHAT, FREE_PHOTO_CLASSIFIER, FREE_QUOTE_READER } from './open-models';
import { NoModelQuoteReader, QUOTE_READER } from './quote-check';
import { NoModelPhotoClassifier, NoModelSpeechToText, PHOTO_CLASSIFIER, SPEECH_TO_TEXT } from './models';
import { SARVAM_FETCH, SarvamSpeechToText } from './sarvam';
import { RuleBasedTopProblems, TOP_PROBLEMS_RANKER } from './top-problems';

/**
 * AI_PROVIDER picks the chat, the photo reader and the quote reader (rules, Claude or Cloudflare Workers AI); the free
 * models in AI_BACKUPS come next (also after Claude), and the rules last;
 * SPEECH_TO_TEXT_PROVIDER picks speech-to-text. The API is the same either way.
 */
@Module({
  imports: [BookingCoreModule],
  controllers: [AiController],
  providers: [
    RuleBasedTopProblems,
    NoModelPhotoClassifier,
    NoModelSpeechToText,
    RuleBasedChat,
    ChatMemory,
    ClaudeChat,
    ClaudePhotoClassifier,
    WorkersAi,
    CloudflareChat,
    CloudflarePhotoClassifier,
    SarvamSpeechToText,
    NoModelQuoteReader,
    ClaudeQuoteReader,
    CloudflareQuoteReader,
    { provide: ANTHROPIC_CLIENT, inject: [APP_CONFIG], useFactory: createAnthropic },
    { provide: SARVAM_FETCH, useValue: (input: string | URL | Request, init?: RequestInit) => fetch(input, init) },
    { provide: CLOUDFLARE_AI_FETCH, useValue: (input: string | URL | Request, init?: RequestInit) => fetch(input, init) },
    { provide: TOP_PROBLEMS_RANKER, useExisting: RuleBasedTopProblems },
    // The free models (Cloudflare and AI_BACKUPS) answer with the rules themselves when none of them can.
    { provide: FREE_CHAT, useExisting: CloudflareChat },
    { provide: FREE_PHOTO_CLASSIFIER, useExisting: CloudflarePhotoClassifier },
    { provide: FREE_QUOTE_READER, useExisting: CloudflareQuoteReader },
    {
      provide: PHOTO_CLASSIFIER,
      inject: [APP_CONFIG, ClaudePhotoClassifier, CloudflarePhotoClassifier, NoModelPhotoClassifier],
      useFactory: (c: Env, claude: ClaudePhotoClassifier, cloudflare: CloudflarePhotoClassifier, rules: NoModelPhotoClassifier) =>
        c.AI_PROVIDER === 'anthropic' ? claude : c.AI_PROVIDER === 'cloudflare' || c.AI_BACKUPS.length > 0 ? cloudflare : rules,
    },
    {
      provide: QUOTE_READER,
      inject: [APP_CONFIG, ClaudeQuoteReader, CloudflareQuoteReader, NoModelQuoteReader],
      useFactory: (c: Env, claude: ClaudeQuoteReader, cloudflare: CloudflareQuoteReader, rules: NoModelQuoteReader) =>
        c.AI_PROVIDER === 'anthropic' ? claude : c.AI_PROVIDER === 'cloudflare' || c.AI_BACKUPS.length > 0 ? cloudflare : rules,
    },
    {
      provide: SPEECH_TO_TEXT,
      inject: [APP_CONFIG, SarvamSpeechToText, NoModelSpeechToText],
      useFactory: (c: Env, sarvam: SarvamSpeechToText, none: NoModelSpeechToText) => (c.SPEECH_TO_TEXT_PROVIDER === 'sarvam' ? sarvam : none),
    },
    {
      provide: CHAT_ASSISTANT,
      inject: [APP_CONFIG, ClaudeChat, CloudflareChat, RuleBasedChat],
      useFactory: (c: Env, claude: ClaudeChat, cloudflare: CloudflareChat, rules: RuleBasedChat) =>
        c.AI_PROVIDER === 'anthropic' ? claude : c.AI_PROVIDER === 'cloudflare' || c.AI_BACKUPS.length > 0 ? cloudflare : rules,
    },
  ],
  exports: [ChatMemory],
})
export class AiModule {}
