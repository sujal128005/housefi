// Sending the sign-in code. Development prints it to the server log; production sends it through MSG91 with a
// DLT-registered template (required for transactional SMS in India).
import { Logger } from '@nestjs/common';

export interface SmsSender {
  /** `phone`: 10-digit Indian mobile without +91. Throws when the provider did not accept the message. */
  sendOtp(phone: string, code: string): Promise<void>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');

const masked = (phone: string) => `******${phone.slice(-4)}`;

/** Development only (config forbids it in production): the code goes to the log instead of an SMS. */
export class ConsoleSmsSender implements SmsSender {
  private readonly log = new Logger('Sms');

  async sendOtp(phone: string, code: string): Promise<void> {
    this.log.warn(`DEV ONLY, no SMS sent: sign-in code for ${masked(phone)} is ${code}`);
  }
}

export interface Msg91Options {
  readonly authKey: string;
  readonly templateId: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * MSG91 "send OTP" API (v5) with our own code, so verification stays on our side (hashed, attempt-limited).
 * Check the request format against the MSG91 dashboard and the DLT template before go-live.
 */
export class Msg91SmsSender implements SmsSender {
  private readonly log = new Logger('Sms');

  constructor(private readonly opts: Msg91Options) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const url = new URL('https://control.msg91.com/api/v5/otp');
    url.searchParams.set('template_id', this.opts.templateId);
    url.searchParams.set('mobile', `91${phone}`);
    url.searchParams.set('otp', code);
    const res = await (this.opts.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { authkey: this.opts.authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
    });
    const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
    if (!res.ok || body.type !== 'success') {
      // The provider message can echo the number; log only the status and type.
      this.log.error(`MSG91 rejected the OTP SMS for ${masked(phone)} (HTTP ${res.status}, type ${body.type ?? 'unknown'})`);
      throw new Error('SMS provider rejected the message');
    }
  }
}
