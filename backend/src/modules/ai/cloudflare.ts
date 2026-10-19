// Open models on Cloudflare Workers AI behind the AI interfaces (AI_PROVIDER=cloudflare), free within Cloudflare's
// daily allowance. Same guarantees as claude.ts, whose instructions, answer shape and checks are shared:
// - The support chat sees only the caller's own booking facts, has no tools, and answers in a fixed JSON shape. The
//   rules answer instead when the model is slow, unavailable or off-format, and always for danger.
// - The photo reader sees one photo the caller uploaded (location already removed) and may only name catalog
//   services; when unsure it names none and the app offers the alternatives.
// Cloudflare does not use Workers AI inputs or outputs to train models. Nothing about the customer (name, phone,
// address) is sent, and message text, photos and answers are never logged.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Locale } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Clock, InjectClock } from '../../common/clock';
import { PrismaService } from '../../common/prisma/prisma.module';
import { OBJECT_STORE, type ObjectStore } from '../../common/storage/object-store';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingCore } from '../bookings/booking-core';
import { type ChatAssistant, type ChatReplyDto, RuleBasedChat } from './chat';
import { soundsDangerous } from './chat-rules';
import {
  CATALOG_TTL_MS,
  type CatalogEntry,
  CHAT_SYSTEM,
  ChatMemory,
  ChatOutput,
  chatAnswer,
  chatTurn,
  ownPhoto,
  PHOTO_SYSTEM,
  photoAnswer,
  photoCatalog,
} from './claude';
import { NoModelPhotoClassifier, type PhotoClassifier, type PhotoSuggestionDto } from './models';

export const CLOUDFLARE_AI_URL = 'https://api.cloudflare.com/client/v4/accounts';

/** Injected so tests never reach Cloudflare. */
export const CLOUDFLARE_AI_FETCH = Symbol('CLOUDFLARE_AI_FETCH');

/** Workers AI request bodies are kept well under its size limit; larger photos get the alternatives. */
const MAX_VISION_BYTES = 3 * 1024 * 1024;
/** Enough for the JSON answer; the reply text itself is clamped afterwards. */
const MAX_ANSWER_TOKENS = 600;

/** A model answer that cannot be used. Only this short reason reaches the logs, never the answer itself. */
class Unusable extends Error {}

const ChatSchema = z.toJSONSchema(ChatOutput);

/**
 * The JSON value in a Workers AI answer. JSON-mode answers arrive as objects; other answers as text, sometimes with
 * words or a code fence around the JSON, so the outermost object is taken.
 */
export function workersAiJson(response: unknown): unknown {
  if (response && typeof response === 'object') return response;
  if (typeof response !== 'string') throw new Unusable('empty answer');
  const start = response.indexOf('{');
  const end = response.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Unusable('not JSON');
  try {
    return JSON.parse(response.slice(start, end + 1));
  } catch {
    throw new Unusable('not JSON');
  }
}

/** Runs Workers AI models over its REST API (one attempt, the shared AI time limit). */
@Injectable()
export class WorkersAi {
  constructor(
    @InjectConfig() private readonly config: Env,
    @Inject(CLOUDFLARE_AI_FETCH) private readonly fetchFn: typeof fetch,
  ) {}

  get enabled(): boolean {
    return this.config.AI_PROVIDER === 'cloudflare' && !!this.config.CLOUDFLARE_ACCOUNT_ID && !!this.config.CLOUDFLARE_AI_TOKEN;
  }

  /** The model's answer as a JSON value; throws Unusable (or a network error) when there is none. */
  async run(model: string, body: object): Promise<unknown> {
    const res = await this.fetchFn(`${CLOUDFLARE_AI_URL}/${this.config.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.CLOUDFLARE_AI_TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.AI_TIMEOUT_MS),
    });
    if (!res.ok) throw new Unusable(`HTTP ${res.status}`);
    const json = (await res.json()) as { success?: boolean; result?: { response?: unknown } | null };
    if (json.success === false || !json.result) throw new Unusable('no result');
    return workersAiJson(json.result.response);
  }
}

/** For logs: the kind of failure, never the request or the answer. */
function failureKind(err: unknown): string {
  if (err instanceof Unusable) return err.message;
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout';
  if (err instanceof z.ZodError) return 'answer in the wrong shape';
  return err instanceof Error ? err.name : 'unknown';
}

@Injectable()
export class CloudflareChat implements ChatAssistant {
  private readonly log = new Logger(CloudflareChat.name);

  constructor(
    private readonly ai: WorkersAi,
    private readonly rules: RuleBasedChat,
    private readonly core: BookingCore,
    private readonly memory: ChatMemory,
    @InjectConfig() private readonly config: Env,
  ) {}

  async reply(input: { customerId: string; message: string; locale: Locale; conversationId: string | null }): Promise<ChatReplyDto> {
    const conversationId = input.conversationId ?? randomUUID();
    if (!this.ai.enabled || soundsDangerous(input.message)) return this.rules.reply({ ...input, conversationId });

    const { policyAnswer, context } = await chatTurn(this.core, this.config, input);
    const history = await this.memory.load(input.customerId, conversationId);

    try {
      const answer = await this.ai.run(this.config.CLOUDFLARE_AI_CHAT_MODEL, {
        messages: [
          { role: 'system', content: `${CHAT_SYSTEM}\n\nAnswer only with JSON matching this schema: ${JSON.stringify(ChatSchema)}` },
          // Earlier turns as plain text; only the newest message carries the booking facts.
          ...history.map((t) => ({ role: t.role, content: t.text })),
          { role: 'user', content: context },
        ],
        response_format: { type: 'json_schema', json_schema: ChatSchema },
        max_tokens: MAX_ANSWER_TOKENS,
        temperature: 0.2,
      });
      const out = ChatOutput.parse(answer);
      if (!out.text.trim()) throw new Unusable('empty answer');
      const reply = chatAnswer(out, input.message);
      await this.memory.append(input.customerId, conversationId, [
        { role: 'user', text: input.message },
        { role: 'assistant', text: reply.text },
      ]);
      return { ...reply, conversationId };
    } catch (err) {
      this.log.warn(`chat model unavailable, answering with the rules (${failureKind(err)})`);
      return { ...policyAnswer, conversationId };
    }
  }
}

@Injectable()
export class CloudflarePhotoClassifier implements PhotoClassifier {
  private readonly log = new Logger(CloudflarePhotoClassifier.name);
  private catalog: { readonly at: number; readonly entries: readonly CatalogEntry[] } | null = null;

  constructor(
    private readonly ai: WorkersAi,
    private readonly fallback: NoModelPhotoClassifier,
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @InjectConfig() private readonly config: Env,
    @InjectClock() private readonly clock: Clock,
  ) {}

  async classify(input: { photoId: string; customerId: string }): Promise<PhotoSuggestionDto> {
    const fallback = () => this.fallback.classify();
    if (!this.ai.enabled) return fallback();
    try {
      const photo = await ownPhoto(this.prisma, this.store, input, MAX_VISION_BYTES);
      if (!photo) return fallback();

      const entries = await this.services();
      const ids = entries.map((e) => e.id);
      if (ids.length === 0) return fallback();
      const ServiceId = z.enum(ids as [string, ...string[]]);
      const Output = z.object({ serviceId: ServiceId.nullable(), confidence: z.number(), alternatives: z.array(ServiceId) });
      const schema = z.toJSONSchema(Output);

      const answer = await this.ai.run(this.config.CLOUDFLARE_AI_VISION_MODEL, {
        messages: [
          { role: 'system', content: `${PHOTO_SYSTEM}\n\nAnswer only with JSON matching this schema: ${JSON.stringify(schema)}` },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${photo.mediaType};base64,${Buffer.from(photo.bytes).toString('base64')}` } },
              { type: 'text', text: `<catalog>${JSON.stringify(entries)}</catalog>` },
            ],
          },
        ],
        guided_json: schema,
        max_tokens: MAX_ANSWER_TOKENS,
        temperature: 0,
      });
      // Ids outside the catalog are dropped by photoAnswer, not trusted.
      const loose = z.object({ serviceId: z.string().nullable(), confidence: z.number(), alternatives: z.array(z.string()) }).parse(answer);
      return photoAnswer(loose, ids, (await fallback()).alternatives);
    } catch (err) {
      this.log.warn(`photo model unavailable, offering alternatives (${failureKind(err)})`);
      return fallback();
    }
  }

  private async services(): Promise<readonly CatalogEntry[]> {
    const now = this.clock.now();
    if (this.catalog && now - this.catalog.at < CATALOG_TTL_MS) return this.catalog.entries;
    const entries = await photoCatalog(this.prisma);
    this.catalog = { at: now, entries };
    return entries;
  }
}
