// Free open models, one after another: Cloudflare Workers AI (AI_PROVIDER=cloudflare) and the backups in AI_BACKUPS
// (Groq, Ollama, Cerebras: OpenAI-style chat completions; Cloudflare can be a backup too). Each question goes to the first
// healthy model that can answer it (photos only to models that read images); an answer that fails, times out or comes
// back in the wrong shape moves on to the next. A model that just failed waits at the back of the line for
// AI_COOLDOWN_MS, so customers are not kept waiting on a service that is down. Every try has AI_ATTEMPT_TIMEOUT_MS and
// the whole question AI_TIMEOUT_MS; when nothing answers, the caller uses Housefi's rules.
// None of these services trains on or keeps the requests by default (checked October 2026); nothing about the
// customer (name, phone, address) is sent, and requests and answers are never logged.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Clock, InjectClock } from '../../common/clock';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';

export const CLOUDFLARE_AI_URL = 'https://api.cloudflare.com/client/v4/accounts';
export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';
export const OLLAMA_URL = 'https://ollama.com/v1/chat/completions';

/** The free models' chat, photo reader and quote reader (cloudflare.ts): Claude's backup before the rules. */
export const FREE_CHAT = Symbol('FREE_CHAT');
export const FREE_PHOTO_CLASSIFIER = Symbol('FREE_PHOTO_CLASSIFIER');
export const FREE_QUOTE_READER = Symbol('FREE_QUOTE_READER');

/** Injected so tests never reach the real services (Cloudflare and the backups share it). */
export const CLOUDFLARE_AI_FETCH = Symbol('CLOUDFLARE_AI_FETCH');

export type ModelName = 'cloudflare' | 'groq' | 'ollama' | 'cerebras';
export type ModelKind = 'chat' | 'vision';

/** A question in the OpenAI chat format; the system message already asks for JSON in `schema`'s shape. */
export interface ModelQuestion {
  readonly messages: readonly object[];
  readonly schema: object;
  readonly maxTokens: number;
  readonly temperature: number;
}

/** A model answer that cannot be used. Only this short reason reaches the logs, never the answer itself. */
export class Unusable extends Error {}

/**
 * The JSON value in a model answer. JSON-mode answers arrive as objects; other answers as text, sometimes with words
 * or a code fence around the JSON, so the outermost object is taken.
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

/** For logs: the kind of failure, never the request or the answer. */
export function failureKind(err: unknown): string {
  if (err instanceof Unusable) return err.message;
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout';
  if (err instanceof Error && err.name === 'ZodError') return 'answer in the wrong shape';
  return err instanceof Error ? err.name : 'unknown';
}

interface Runner {
  readonly name: ModelName;
  readonly models: Partial<Record<ModelKind, string>>;
  ask(kind: ModelKind, q: ModelQuestion, timeoutMs: number): Promise<unknown>;
}

/** The free models in order, with the health of each (per kind of question). */
@Injectable()
export class WorkersAi {
  private readonly log = new Logger('OpenModels');
  private readonly runners: readonly Runner[];
  /** Until when a model waits at the back of the line, per `${name}:${kind}`. */
  private readonly coolUntil = new Map<string, number>();

  constructor(
    @InjectConfig() private readonly config: Env,
    @Inject(CLOUDFLARE_AI_FETCH) private readonly fetchFn: typeof fetch,
    @InjectClock() private readonly clock: Clock,
  ) {
    const order = [...new Set<ModelName>([...(config.AI_PROVIDER === 'cloudflare' ? (['cloudflare'] as const) : []), ...config.AI_BACKUPS])];
    this.runners = order.flatMap((name) => {
      const r = this.runner(name);
      return r ? [r] : [];
    });
  }

  /** The models that can answer this kind of question, in order. */
  names(kind: ModelKind): ModelName[] {
    return this.runners.filter((r) => r.models[kind]).map((r) => r.name);
  }

  /** At least one model can answer this kind of question (otherwise the caller uses the rules straight away). */
  can(kind: ModelKind): boolean {
    return this.runners.some((r) => r.models[kind]);
  }

  /**
   * The first usable answer: `accept` checks the model's JSON and throws when it is unusable (the next model is
   * tried). Throws when no model gave a usable answer in time.
   */
  async ask<T>(kind: ModelKind, q: ModelQuestion, accept: (json: unknown) => T): Promise<T> {
    const start = this.clock.now();
    const now = start;
    const able = this.runners.filter((r) => r.models[kind]);
    // Healthy models first, in the configured order; ones that just failed last.
    const line = [...able.filter((r) => (this.coolUntil.get(`${r.name}:${kind}`) ?? 0) <= now), ...able.filter((r) => (this.coolUntil.get(`${r.name}:${kind}`) ?? 0) > now)];
    const failures: string[] = [];
    for (const r of line) {
      const left = this.config.AI_TIMEOUT_MS - (this.clock.now() - start);
      if (left < 500) break;
      try {
        const answer = accept(await r.ask(kind, q, Math.min(this.config.AI_ATTEMPT_TIMEOUT_MS, left)));
        this.coolUntil.delete(`${r.name}:${kind}`);
        if (failures.length) this.log.log(`${kind}: answered by ${r.name} after ${failures.join(', ')}`);
        return answer;
      } catch (err) {
        failures.push(`${r.name} ${failureKind(err)}`);
        this.coolUntil.set(`${r.name}:${kind}`, this.clock.now() + this.config.AI_COOLDOWN_MS);
      }
    }
    throw new Unusable(failures.length ? failures.join(', ') : 'no model free');
  }

  private runner(name: ModelName): Runner | null {
    const c = this.config;
    if (name === 'cloudflare') {
      if (!c.CLOUDFLARE_ACCOUNT_ID || !c.CLOUDFLARE_AI_TOKEN) return null;
      return {
        name,
        models: { chat: c.CLOUDFLARE_AI_CHAT_MODEL, vision: c.CLOUDFLARE_AI_VISION_MODEL },
        ask: async (kind, q, timeoutMs) => {
          const model = kind === 'chat' ? c.CLOUDFLARE_AI_CHAT_MODEL : c.CLOUDFLARE_AI_VISION_MODEL;
          const res = await this.fetchFn(`${CLOUDFLARE_AI_URL}/${c.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${c.CLOUDFLARE_AI_TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              messages: q.messages,
              // Text models take a JSON schema as the response format; the vision model takes it as guided JSON.
              ...(kind === 'chat' ? { response_format: { type: 'json_schema', json_schema: q.schema } } : { guided_json: q.schema }),
              max_tokens: q.maxTokens,
              temperature: q.temperature,
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!res.ok) throw new Unusable(`HTTP ${res.status}`);
          const json = (await res.json()) as { success?: boolean; result?: { response?: unknown } | null };
          if (json.success === false || !json.result) throw new Unusable('no result');
          return workersAiJson(json.result.response);
        },
      };
    }
    const key = name === 'groq' ? c.GROQ_API_KEY : name === 'ollama' ? c.OLLAMA_API_KEY : c.CEREBRAS_API_KEY;
    if (!key) return null;
    const url = name === 'groq' ? GROQ_URL : name === 'ollama' ? OLLAMA_URL : CEREBRAS_URL;
    // Cerebras has no image model; Ollama reads photos only with OLLAMA_VISION_MODEL set.
    const models: Partial<Record<ModelKind, string>> =
      name === 'groq'
        ? { chat: c.GROQ_CHAT_MODEL, vision: c.GROQ_VISION_MODEL }
        : name === 'ollama'
          ? { chat: c.OLLAMA_CHAT_MODEL, ...(c.OLLAMA_VISION_MODEL ? { vision: c.OLLAMA_VISION_MODEL } : {}) }
          : { chat: c.CEREBRAS_CHAT_MODEL };
    return {
      name,
      models,
      ask: async (kind, q, timeoutMs) => {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ model: models[kind], messages: q.messages, response_format: { type: 'json_object' }, max_tokens: q.maxTokens, temperature: q.temperature }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Unusable(`HTTP ${res.status}`);
        const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
        return workersAiJson(json.choices?.[0]?.message?.content);
      },
    };
  }
}
