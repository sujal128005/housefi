// Voice notes to text with Sarvam AI (SPEECH_TO_TEXT_PROVIDER=sarvam): Indian languages, Telugu included. Its
// real-time endpoint takes recordings up to 30 s; a longer note keeps only its audio (the transcript stays empty), as
// with no provider at all. The audio is the caller's own upload; neither it nor the transcript is ever logged.
// Check the endpoint, field names and model name against Sarvam's API reference with a test key before go-live.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Locale } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.module';
import { OBJECT_STORE, type ObjectStore, verifiedKey } from '../../common/storage/object-store';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { MAX_BYTES } from '../uploads/uploads.service';
import type { SpeechToText } from './models';

export const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text';
/** Sarvam's limit for the real-time endpoint. */
export const SARVAM_MAX_SEC = 30;
const MAX_TRANSCRIPT_CHARS = 1000;

const FILE_NAMES: Readonly<Record<string, string>> = { 'audio/m4a': 'note.m4a', 'audio/mp4': 'note.m4a', 'audio/aac': 'note.aac' };
/**
 * The file type Sarvam is told. It refuses "audio/m4a" (HTTP 400 "Invalid file type"), the type phones give their
 * voice notes, and takes the same file as "audio/x-m4a". The audio itself is not changed.
 */
const SARVAM_TYPES: Readonly<Record<string, string>> = { 'audio/m4a': 'audio/x-m4a' };

/** Injected so tests never reach Sarvam. */
export const SARVAM_FETCH = Symbol('SARVAM_FETCH');

@Injectable()
export class SarvamSpeechToText implements SpeechToText {
  private readonly log = new Logger(SarvamSpeechToText.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @InjectConfig() private readonly config: Env,
    @Inject(SARVAM_FETCH) private readonly fetchFn: typeof fetch,
  ) {}

  async transcribe(input: { audioId: string; customerId: string; locale: Locale }): Promise<string> {
    if (!this.config.SARVAM_API_KEY) return '';
    const upload = await this.prisma.upload.findUnique({ where: { id: input.audioId }, select: { ownerId: true, state: true, contentType: true, durationSec: true } });
    if (!upload || upload.ownerId !== input.customerId || upload.state !== 'READY') return '';
    if ((upload.durationSec ?? Infinity) > SARVAM_MAX_SEC) return '';
    const bytes = await this.store.get(verifiedKey(input.audioId), MAX_BYTES.AUDIO);
    if (!bytes) return '';

    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(bytes)], { type: SARVAM_TYPES[upload.contentType] ?? upload.contentType }), FILE_NAMES[upload.contentType] ?? 'note.m4a');
    form.append('model', this.config.SARVAM_STT_MODEL);
    form.append('language_code', input.locale === 'te' ? 'te-IN' : 'en-IN');
    try {
      const res = await this.fetchFn(SARVAM_STT_URL, {
        method: 'POST',
        headers: { 'api-subscription-key': this.config.SARVAM_API_KEY, accept: 'application/json' },
        body: form,
        signal: AbortSignal.timeout(this.config.AI_TIMEOUT_MS),
      });
      // Sarvam's error says what it refused (never contains the audio or a transcript).
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`);
      const body = (await res.json()) as { transcript?: unknown };
      return typeof body.transcript === 'string' ? body.transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS) : '';
    } catch (err) {
      // The app keeps the voice note as audio; the technician can still play it.
      this.log.warn(`speech-to-text unavailable (${err instanceof Error ? err.message.slice(0, 160) : 'unknown'})`);
      return '';
    }
  }
}
