// The support assistant behind an interface: rules today (chat-rules.ts), a model with tools later (README §12), with
// the same guarantee: it reads only the caller's own bookings.
import { Injectable } from '@nestjs/common';
import type { Locale } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { InjectConfig } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingCore } from '../bookings/booking-core';
import type { BookingDto } from '../bookings/booking-view';
import { type ChatAnswer, type ChatBooking, chatReply } from './chat-rules';

/** openapi.yaml ChatReply. */
export interface ChatReplyDto extends ChatAnswer {
  readonly conversationId: string;
}

export interface ChatAssistant {
  reply(input: { readonly customerId: string; readonly message: string; readonly locale: Locale; readonly conversationId: string | null }): Promise<ChatReplyDto>;
}

export const CHAT_ASSISTANT = Symbol('CHAT_ASSISTANT');

/** What the assistant sees of a booking: status, code, the technician's first name, and the amounts waiting. */
export function chatBooking(b: BookingDto): ChatBooking {
  const pending = (q: BookingDto['quote']) => (q && q.decision === 'PENDING' ? q.total : null);
  return {
    code: b.code,
    status: b.status,
    technicianName: b.technician?.name.en.split(/\s+/)[0] || null,
    etaMin: b.etaMin,
    quoteTotal: pending(b.quote),
    extraTotal: pending(b.extraQuote),
    billAmount: b.finalPayment && b.finalPayment.state !== 'PAID' ? b.finalPayment.amount : null,
  };
}

/** Stateless: each message is answered on its own; the conversation id is echoed (or started) for the app and for later. */
@Injectable()
export class RuleBasedChat implements ChatAssistant {
  constructor(
    private readonly core: BookingCore,
    @InjectConfig() private readonly config: Env,
  ) {}

  async reply(input: { customerId: string; message: string; locale: Locale; conversationId: string | null }): Promise<ChatReplyDto> {
    // The newest booking still in progress (the list is the caller's own, newest first).
    const [active] = await this.core.list(input.customerId, 'active');
    const answer = chatReply(input.message, input.locale, active ? chatBooking(active) : null, { visitFee: this.config.VISIT_FEE_RUPEES, quoteMin: this.config.QUOTE_MIN_RUPEES });
    return { ...answer, conversationId: input.conversationId ?? randomUUID() };
  }
}
