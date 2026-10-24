// Free open models behind the AI interfaces: Cloudflare Workers AI (AI_PROVIDER=cloudflare) and the backups in
// AI_BACKUPS (Groq, Cerebras), asked one after another by open-models.ts. Same guarantees as claude.ts, whose
// instructions, answer shape and checks are shared:
// - The support chat sees only the caller's own booking facts, has no tools, and answers in a fixed JSON shape. The
//   rules answer instead when the model is slow, unavailable or off-format, and always for danger.
// - The photo reader sees one photo the caller uploaded (location already removed) and may only name catalog
//   services; when unsure it names none and the app offers the alternatives.
// None of these services trains on the requests or keeps them by default. Nothing about the customer (name, phone,
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
import { answeredByRules } from './chat-rules';
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
import { failureKind, Unusable, WorkersAi } from './open-models';
import { NOT_READ, QUOTE_SYSTEM, quoteAnswer, quoteCatalog, quoteOutput, type QuoteReadDto, type QuoteReader } from './quote-check';

// Kept here for the tests and older imports.
export { CLOUDFLARE_AI_FETCH, CLOUDFLARE_AI_URL, WorkersAi, workersAiJson } from './open-models';

/** Workers AI request bodies are kept well under its size limit; larger photos get the alternatives. */
const MAX_VISION_BYTES = 3 * 1024 * 1024;
/** Enough for the JSON answer; the reply text itself is clamped afterwards. */
const MAX_ANSWER_TOKENS = 600;
/** A quote can have up to 20 lines. */
const QUOTE_ANSWER_TOKENS = 2000;

const ChatSchema = z.toJSONSchema(ChatOutput);

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
    if (!this.ai.can('chat') || answeredByRules(input.message)) return this.rules.reply({ ...input, conversationId });

    const { policyAnswer, context } = await chatTurn(this.core, this.config, input);
    const history = await this.memory.load(input.customerId, conversationId);

    try {
      const out = await this.ai.ask(
        'chat',
        {
          messages: [
            { role: 'system', content: `${CHAT_SYSTEM}\n\nAnswer only with JSON matching this schema: ${JSON.stringify(ChatSchema)}` },
            // Earlier turns as plain text; only the newest message carries the booking facts.
            ...history.map((t) => ({ role: t.role, content: t.text })),
            { role: 'user', content: context },
          ],
          schema: ChatSchema,
          maxTokens: MAX_ANSWER_TOKENS,
          temperature: 0.2,
        },
        (answer) => {
          const parsed = ChatOutput.parse(answer);
          if (!parsed.text.trim()) throw new Unusable('empty answer');
          return parsed;
        },
      );
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
    if (!this.ai.can('vision')) return fallback();
    try {
      const photo = await ownPhoto(this.prisma, this.store, input, MAX_VISION_BYTES);
      if (!photo) return fallback();

      const entries = await this.services();
      const ids = entries.map((e) => e.id);
      if (ids.length === 0) return fallback();
      const ServiceId = z.enum(ids as [string, ...string[]]);
      const Output = z.object({ serviceId: ServiceId.nullable(), confidence: z.number(), alternatives: z.array(ServiceId) });
      const schema = z.toJSONSchema(Output);

      const loose = await this.ai.ask(
        'vision',
        {
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
          schema,
          maxTokens: MAX_ANSWER_TOKENS,
          temperature: 0,
        },
        // Ids outside the catalog are dropped by photoAnswer, not trusted.
        (answer) => z.object({ serviceId: z.string().nullable(), confidence: z.number(), alternatives: z.array(z.string()) }).parse(answer),
      );
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

/** Reads a photographed repair quote into lines (quote-check.ts); the rules compare the prices. */
@Injectable()
export class CloudflareQuoteReader implements QuoteReader {
  private readonly log = new Logger(CloudflareQuoteReader.name);

  constructor(
    private readonly ai: WorkersAi,
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @InjectConfig() private readonly config: Env,
  ) {}

  async read(input: { photoId: string; customerId: string }): Promise<QuoteReadDto> {
    if (!this.ai.can('vision')) return NOT_READ;
    try {
      const photo = await ownPhoto(this.prisma, this.store, input, MAX_VISION_BYTES);
      if (!photo) return NOT_READ;
      const catalog = await quoteCatalog(this.prisma);
      const serviceIds = catalog.services.map((s) => s.id);
      const partIds = catalog.parts.map((p) => p.id);
      if (serviceIds.length === 0) return NOT_READ;
      const schema = z.toJSONSchema(quoteOutput(serviceIds, partIds));
      const loose = await this.ai.ask(
        'vision',
        {
          messages: [
            { role: 'system', content: `${QUOTE_SYSTEM}\n\nAnswer only with JSON matching this schema: ${JSON.stringify(schema)}` },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${photo.mediaType};base64,${Buffer.from(photo.bytes).toString('base64')}` } },
                { type: 'text', text: `<catalog>${JSON.stringify(catalog.services)}</catalog>\n<parts>${JSON.stringify(catalog.parts)}</parts>` },
              ],
            },
          ],
          schema,
          maxTokens: QUOTE_ANSWER_TOKENS,
          temperature: 0,
        },
        // Ids outside the catalog and the price list are dropped by quoteAnswer, not trusted.
        (answer) =>
          z
            .object({
              readable: z.boolean(),
              serviceId: z.string().nullable(),
              lines: z.array(z.object({ name: z.string(), kind: z.string(), qty: z.number(), amount: z.number(), partId: z.string().nullable() })),
            })
            .parse(answer),
      );
      return quoteAnswer(loose, serviceIds, partIds);
    } catch (err) {
      this.log.warn(`quote reader unavailable, the customer types the lines (${failureKind(err)})`);
      return NOT_READ;
    }
  }
}
