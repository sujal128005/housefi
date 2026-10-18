// The few Razorpay REST calls we need (https://razorpay.com/docs/api/), behind an interface so tests use a fake.
// Amounts are in paise, as Razorpay expects.

export interface RzpOrder {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
}

/** Razorpay payment statuses: created -> authorized -> captured (or failed); refunded after a full refund. */
export type RzpPaymentStatus = 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';

export interface RzpPayment {
  readonly id: string;
  readonly order_id: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: RzpPaymentStatus;
  readonly method?: string;
  readonly error_code?: string | null;
}

export interface RzpRefund {
  readonly id: string;
  readonly payment_id: string;
  readonly amount: number;
  readonly status: 'pending' | 'processed' | 'failed';
}

export interface RazorpayClient {
  createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<RzpOrder>;
  fetchPayment(paymentId: string): Promise<RzpPayment>;
  fetchOrderPayments(orderId: string): Promise<RzpPayment[]>;
  capture(paymentId: string, amountPaise: number): Promise<RzpPayment>;
  refund(paymentId: string, input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<RzpRefund>;
}

export const RAZORPAY_CLIENT = Symbol('RAZORPAY_CLIENT');

export class RazorpayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Razorpay HTTP ${status} (${code})`);
    this.name = 'RazorpayError';
  }
}

export interface HttpRazorpayOptions {
  readonly keyId: string;
  readonly keySecret: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}

export class HttpRazorpayClient implements RazorpayClient {
  private readonly auth: string;
  private readonly base: string;

  constructor(private readonly opts: HttpRazorpayOptions) {
    this.auth = `Basic ${Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString('base64')}`;
    this.base = opts.baseUrl ?? 'https://api.razorpay.com/v1';
  }

  createOrder({ amountPaise, receipt, notes }: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<RzpOrder> {
    return this.call('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, notes });
  }

  fetchPayment(paymentId: string): Promise<RzpPayment> {
    return this.call('GET', `/payments/${encodeURIComponent(paymentId)}`);
  }

  async fetchOrderPayments(orderId: string): Promise<RzpPayment[]> {
    const page = await this.call<{ items: RzpPayment[] }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
    return page.items;
  }

  capture(paymentId: string, amountPaise: number): Promise<RzpPayment> {
    return this.call('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: 'INR' });
  }

  refund(paymentId: string, { amountPaise, receipt, notes }: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<RzpRefund> {
    return this.call('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, speed: 'normal', receipt, notes });
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await (this.opts.fetch ?? fetch)(`${this.base}${path}`, {
      method,
      headers: { authorization: this.auth, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    // Error bodies can echo customer details; keep only the code.
    if (!res.ok) throw new RazorpayError(res.status, json.error?.code ?? 'UNKNOWN');
    return json as T;
  }
}
