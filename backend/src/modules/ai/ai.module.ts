import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { AiController } from './ai.controller';
import { CHAT_ASSISTANT, RuleBasedChat } from './chat';
import { ANTHROPIC_CLIENT, ChatMemory, ClaudeChat, ClaudePhotoClassifier, createAnthropic } from './claude';
import { CLOUDFLARE_AI_FETCH, CloudflareChat, CloudflarePhotoClassifier, WorkersAi } from './cloudflare';
import { NoModelPhotoClassifier, NoModelSpeechToText, PHOTO_CLASSIFIER, SPEECH_TO_TEXT } from './models';
import { SARVAM_FETCH, SarvamSpeechToText } from './sarvam';
import { RuleBasedTopProblems, TOP_PROBLEMS_RANKER } from './top-problems';

/**
 * AI_PROVIDER picks the chat and the photo reader (rules, or Claude or Cloudflare Workers AI with the rules as their
 * fallback);
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
    { provide: ANTHROPIC_CLIENT, inject: [APP_CONFIG], useFactory: createAnthropic },
    { provide: SARVAM_FETCH, useValue: (input: string | URL | Request, init?: RequestInit) => fetch(input, init) },
    { provide: CLOUDFLARE_AI_FETCH, useValue: (input: string | URL | Request, init?: RequestInit) => fetch(input, init) },
    { provide: TOP_PROBLEMS_RANKER, useExisting: RuleBasedTopProblems },
    {
      provide: PHOTO_CLASSIFIER,
      inject: [APP_CONFIG, ClaudePhotoClassifier, CloudflarePhotoClassifier, NoModelPhotoClassifier],
      useFactory: (c: Env, claude: ClaudePhotoClassifier, cloudflare: CloudflarePhotoClassifier, rules: NoModelPhotoClassifier) =>
        c.AI_PROVIDER === 'anthropic' ? claude : c.AI_PROVIDER === 'cloudflare' ? cloudflare : rules,
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
        c.AI_PROVIDER === 'anthropic' ? claude : c.AI_PROVIDER === 'cloudflare' ? cloudflare : rules,
    },
  ],
  exports: [ChatMemory],
})
export class AiModule {}
