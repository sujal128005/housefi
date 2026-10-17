import { Module } from '@nestjs/common';
import { BookingCoreModule } from '../bookings/booking-core.module';
import { AiController } from './ai.controller';
import { CHAT_ASSISTANT, RuleBasedChat } from './chat';
import { NoModelPhotoClassifier, NoModelSpeechToText, PHOTO_CLASSIFIER, SPEECH_TO_TEXT } from './models';
import { RuleBasedTopProblems, TOP_PROBLEMS_RANKER } from './top-problems';

/** Swap an implementation here (a vision model, a speech service, a model-backed chat) without touching the API. */
@Module({
  imports: [BookingCoreModule],
  controllers: [AiController],
  providers: [
    RuleBasedTopProblems,
    NoModelPhotoClassifier,
    NoModelSpeechToText,
    RuleBasedChat,
    { provide: TOP_PROBLEMS_RANKER, useExisting: RuleBasedTopProblems },
    { provide: PHOTO_CLASSIFIER, useExisting: NoModelPhotoClassifier },
    { provide: SPEECH_TO_TEXT, useExisting: NoModelSpeechToText },
    { provide: CHAT_ASSISTANT, useExisting: RuleBasedChat },
  ],
})
export class AiModule {}
