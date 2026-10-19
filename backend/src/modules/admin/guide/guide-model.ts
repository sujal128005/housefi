// The model behind Sarathi, picked by AI_PROVIDER like the app's assistant: Claude (native tool use), Cloudflare
// Workers AI (a JSON protocol, since open models' tool calling varies), or none (the guide's basic mode). Whatever
// the model, it can only call the tools it is given, and those only look or propose (guide-tools.ts).
import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { InjectConfig } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { WorkersAi } from '../../ai/cloudflare';
import type { ToolSpec } from './guide-tools';

export const GUIDE_ANTHROPIC = Symbol('GUIDE_ANTHROPIC');

/** The guide reads several tools per question: a longer time limit than the app's assistant. */
export function createGuideAnthropic(config: Env): Anthropic | null {
  if (config.AI_PROVIDER !== 'anthropic' || !config.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: Math.max(config.AI_TIMEOUT_MS, 60_000), maxRetries: 1 });
}

export interface GuideTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface GuidePhoto {
  readonly mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly base64: string;
}

export interface GuideRun {
  readonly system: string;
  readonly history: readonly GuideTurn[];
  readonly message: string;
  readonly photo: GuidePhoto | null;
  readonly tools: readonly ToolSpec[];
  /** Runs one tool; the answer (JSON text) goes back to the model. Never throws. */
  readonly call: (name: string, args: unknown) => Promise<string>;
  readonly maxSteps: number;
}

export interface GuideModel {
  readonly available: boolean;
  /** The final answer for the admin. Throws when the model cannot be reached (the service says so). */
  answer(run: GuideRun): Promise<string>;
}

export const GUIDE_MODEL = Symbol('GUIDE_MODEL');

function schemaOf(t: ToolSpec): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(t.params) as Record<string, unknown>;
  return rest;
}

@Injectable()
export class ClaudeGuideModel implements GuideModel {
  constructor(
    @Inject(GUIDE_ANTHROPIC) private readonly client: Anthropic | null,
    @InjectConfig() private readonly config: Env,
  ) {}

  get available(): boolean {
    return !!this.client;
  }

  async answer(run: GuideRun): Promise<string> {
    if (!this.client) throw new Error('no model');
    const tools: Anthropic.Tool[] = run.tools.map((t) => ({ name: t.name, description: t.description, input_schema: schemaOf(t) as Anthropic.Tool.InputSchema }));
    const first: Anthropic.ContentBlockParam[] = [
      ...(run.photo ? [{ type: 'image' as const, source: { type: 'base64' as const, media_type: run.photo.mediaType, data: run.photo.base64 } }] : []),
      { type: 'text', text: run.message },
    ];
    const messages: Anthropic.MessageParam[] = [...run.history.map((h) => ({ role: h.role, content: h.text })), { role: 'user', content: first }];
    for (let step = 0; step <= run.maxSteps; step++) {
      const last = step === run.maxSteps;
      const res = await this.client.messages.create({
        model: this.config.AI_CHAT_MODEL,
        max_tokens: 3000,
        system: run.system,
        tools,
        // After the last allowed step it must answer with what it has.
        ...(last ? { tool_choice: { type: 'none' as const } } : {}),
        messages,
      });
      const uses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || uses.length === 0 || last) {
        const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map((c) => c.text).join('\n').trim();
        if (!text) throw new Error(`no answer (${res.stop_reason ?? 'unknown'})`);
        return text;
      }
      messages.push({ role: 'assistant', content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) results.push({ type: 'tool_result', tool_use_id: u.id, content: await run.call(u.name, u.input) });
      messages.push({ role: 'user', content: results });
    }
    throw new Error('no answer');
  }
}

const Decision = z.object({
  tool: z.string().nullable(),
  args: z.record(z.string(), z.unknown()).nullable().optional(),
  answer: z.string().nullable().optional(),
});
const DecisionSchema = z.toJSONSchema(Decision);

@Injectable()
export class CloudflareGuideModel implements GuideModel {
  private readonly log = new Logger(CloudflareGuideModel.name);

  constructor(
    private readonly ai: WorkersAi,
    @InjectConfig() private readonly config: Env,
  ) {}

  get available(): boolean {
    return this.ai.enabled;
  }

  async answer(run: GuideRun): Promise<string> {
    const catalog = run.tools.map((t) => `- ${t.name}: ${t.description} Parameters: ${JSON.stringify(schemaOf(t).properties ?? {})}`).join('\n');
    const protocol = `\n\nTOOLS (call at most one per reply):\n${catalog}\n\nReply ONLY with JSON: {"tool": "<tool name>", "args": {...}} to use a tool, or {"tool": null, "answer": "<your answer to the admin>"} when you can answer. Tool results come back inside <tool_result>.`;
    let message = run.message;
    if (run.photo) message = `${message}\n\n<photo_description>${await this.describe(run.photo)}</photo_description>`;
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: run.system + protocol },
      ...run.history.map((h) => ({ role: h.role, content: h.text })),
      { role: 'user', content: message },
    ];
    for (let step = 0; step <= run.maxSteps; step++) {
      const last = step === run.maxSteps;
      if (last) messages.push({ role: 'user', content: 'Answer the admin now with what you have: {"tool": null, "answer": "..."}' });
      const raw = await this.ai.run(this.config.CLOUDFLARE_AI_CHAT_MODEL, { messages, response_format: { type: 'json_schema', json_schema: DecisionSchema }, max_tokens: 1500, temperature: 0.2 });
      const d = Decision.parse(raw);
      if (!d.tool || last) {
        const text = (d.answer ?? '').trim();
        if (!text) throw new Error('no answer');
        return text;
      }
      messages.push({ role: 'assistant', content: JSON.stringify({ tool: d.tool, args: d.args ?? {} }) });
      messages.push({ role: 'user', content: `<tool_result name="${d.tool}">${await run.call(d.tool, d.args ?? {})}</tool_result>` });
    }
    throw new Error('no answer');
  }

  /** Open text models do not see images: the vision model describes it first (text and codes in it too). */
  private async describe(photo: GuidePhoto): Promise<string> {
    try {
      const raw = await this.ai.run(this.config.CLOUDFLARE_AI_VISION_MODEL, {
        messages: [
          { role: 'system', content: 'Describe this image for an operations admin of a home-repair company. Copy any visible text exactly (booking codes like HF-12345, names, amounts, error messages). Plain text, at most 120 words. Answer only with JSON {"description": "..."}.' },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${photo.mediaType};base64,${photo.base64}` } }] },
        ],
        max_tokens: 400,
        temperature: 0,
      });
      return z.object({ description: z.string() }).parse(raw).description.slice(0, 1500);
    } catch (err) {
      this.log.warn(`photo description unavailable (${err instanceof Error ? err.name : 'unknown'})`);
      return '(the photo could not be read)';
    }
  }
}
