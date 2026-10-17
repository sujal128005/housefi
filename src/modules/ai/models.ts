// Photo understanding and speech-to-text. v1 has no model for either (README §12 "AI models: later"), so these are
// honest stand-ins: the photo classifier does not guess, it offers the services people book most; speech-to-text
// returns no text, and the app keeps the voice note as audio. Each sits behind an interface (and a DI token) so a
// vision model or a Telugu-capable speech service can be plugged in without changing the API.
import { Inject, Injectable } from '@nestjs/common';
import type { Locale } from '@prisma/client';
import { TOP_PROBLEMS_RANKER, type TopProblemsRanker } from './top-problems';

/** openapi.yaml PhotoSuggestion. */
export interface PhotoSuggestionDto {
  /** The service the photo shows; null when the classifier is not sure (always, until a model exists). */
  readonly serviceId: string | null;
  readonly confidence: number;
  /** Services to offer instead, most likely first. */
  readonly alternatives: readonly string[];
}

export interface PhotoClassifier {
  classify(input: { readonly photoId: string; readonly customerId: string }): Promise<PhotoSuggestionDto>;
}

export interface SpeechToText {
  transcribe(input: { readonly audioId: string; readonly customerId: string; readonly locale: Locale; readonly serviceId: string | null }): Promise<string>;
}

export const PHOTO_CLASSIFIER = Symbol('PHOTO_CLASSIFIER');
export const SPEECH_TO_TEXT = Symbol('SPEECH_TO_TEXT');

/** How many services the photo screen offers when it cannot tell. */
export const PHOTO_ALTERNATIVES = 4;

@Injectable()
export class NoModelPhotoClassifier implements PhotoClassifier {
  constructor(@Inject(TOP_PROBLEMS_RANKER) private readonly ranker: TopProblemsRanker) {}

  async classify(): Promise<PhotoSuggestionDto> {
    const { items } = await this.ranker.rank(null);
    return { serviceId: null, confidence: 0, alternatives: [...new Set(items.map((i) => i.serviceId))].slice(0, PHOTO_ALTERNATIVES) };
  }
}

@Injectable()
export class NoModelSpeechToText implements SpeechToText {
  async transcribe(): Promise<string> {
    return '';
  }
}
