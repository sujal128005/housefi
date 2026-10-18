// Placing phone calls, behind an interface so development and tests never dial a real number.
//
// Exotel (Indian telephony provider) model used here:
// - Job offers: the API calls the technician and connects the answered call to the Housefi offer flow (an Exotel
//   app: a greeting read from our URL, keypad input, and Passthru steps that ask our URLs what to do next).
// - Masked calls: the customer or technician dials the Housefi ExoPhone; the inbound flow's Connect step asks our URL
//   whom to connect, so neither side ever sees the other's number.
// Check the request and callback formats against the Exotel dashboard and a sandbox call before go-live
// (docs/TELEPHONY.md lists the exact flow to build).

export interface OfferCallRequest {
  /** 10-digit Indian mobile (without +91). */
  readonly to: string;
  /** Our attempt id; Exotel sends it back as CustomField in every callback for this call. */
  readonly attemptId: string;
  readonly statusCallbackUrl: string;
  readonly ringTimeoutSec: number;
  readonly timeLimitSec: number;
}

export interface TelephonyProvider {
  readonly name: 'exotel' | 'fake';
  /** Starts an outbound offer call. Returns the provider's call id. Throws when the call could not be placed. */
  callForOffer(req: OfferCallRequest): Promise<{ readonly callId: string }>;
}

export const TELEPHONY_PROVIDER = Symbol('TELEPHONY_PROVIDER');

export interface ExotelOptions {
  readonly sid: string;
  readonly apiKey: string;
  readonly apiToken: string;
  readonly subdomain: string;
  readonly callerId: string;
  readonly offerFlowId: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Exotel Voice API v1: "connect a number to a call flow". */
export class ExotelTelephony implements TelephonyProvider {
  readonly name = 'exotel' as const;

  constructor(private readonly opts: ExotelOptions) {}

  async callForOffer(req: OfferCallRequest): Promise<{ readonly callId: string }> {
    const { sid, apiKey, apiToken, subdomain, callerId, offerFlowId } = this.opts;
    const form = new URLSearchParams({
      From: `0${req.to}`,
      CallerId: callerId,
      Url: `http://my.exotel.com/${sid}/exoml/start_voice/${offerFlowId}`,
      CallType: 'trans',
      TimeLimit: String(req.timeLimitSec),
      TimeOut: String(req.ringTimeoutSec),
      CustomField: req.attemptId,
      StatusCallback: req.statusCallbackUrl,
      'StatusCallbackEvents[0]': 'terminal',
      'StatusCallbackEvents[1]': 'answered',
      StatusCallbackContentType: 'application/json',
    });
    const res = await (this.opts.fetch ?? fetch)(`https://${subdomain}/v1/Accounts/${sid}/Calls/connect.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${apiKey}:${apiToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000),
    });
    const body = (await res.json().catch(() => ({}))) as { Call?: { Sid?: string } };
    // The error body can echo the number: report only the status.
    if (!res.ok || !body.Call?.Sid) throw new Error(`Exotel refused the call (HTTP ${res.status})`);
    return { callId: body.Call.Sid };
  }
}

/** Development and tests: records calls, never dials. Can be told to fail. */
export class FakeTelephony implements TelephonyProvider {
  readonly name = 'fake' as const;
  readonly calls: OfferCallRequest[] = [];
  failNext = 0;
  private n = 0;

  async callForOffer(req: OfferCallRequest): Promise<{ readonly callId: string }> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('provider unavailable');
    }
    this.calls.push(req);
    return { callId: `fakecall_${++this.n}` };
  }
}
