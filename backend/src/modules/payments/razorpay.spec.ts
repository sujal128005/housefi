import { createHmac } from 'node:crypto';
import { HttpRazorpayClient, RazorpayError } from './razorpay.client';
import { verifyCheckoutSignature, verifyWebhookSignature } from './razorpay.signatures';

describe('Razorpay signatures', () => {
  const secret = 'test_key_secret';

  it('accepts the checkout signature HMAC(secret, "order|payment") and nothing else', () => {
    const sig = createHmac('sha256', secret).update('order_9A33XWu170gUtm|pay_29QQoUBi66xm2f').digest('hex');
    expect(verifyCheckoutSignature('order_9A33XWu170gUtm', 'pay_29QQoUBi66xm2f', sig, secret)).toBe(true);
    expect(verifyCheckoutSignature('order_9A33XWu170gUtm', 'pay_other', sig, secret)).toBe(false);
    expect(verifyCheckoutSignature('order_9A33XWu170gUtm', 'pay_29QQoUBi66xm2f', sig, 'other_secret')).toBe(false);
    expect(verifyCheckoutSignature('order_9A33XWu170gUtm', 'pay_29QQoUBi66xm2f', sig.toUpperCase(), secret)).toBe(true);
    for (const bad of ['', 'zz', sig.slice(0, 63), `${sig}00`]) expect(verifyCheckoutSignature('order_9A33XWu170gUtm', 'pay_29QQoUBi66xm2f', bad, secret)).toBe(false);
  });

  it('accepts the webhook signature over the exact raw bytes', () => {
    const raw = Buffer.from('{"event":"payment.captured","payload":{}}');
    const sig = createHmac('sha256', 'whsec').update(raw).digest('hex');
    expect(verifyWebhookSignature(raw, sig, 'whsec')).toBe(true);
    // The same JSON with different spacing is a different body.
    expect(verifyWebhookSignature(Buffer.from('{"event": "payment.captured","payload":{}}'), sig, 'whsec')).toBe(false);
  });
});

describe('HttpRazorpayClient', () => {
  function client(status = 200, body: unknown = { id: 'order_1', amount: 4900, currency: 'INR' }) {
    const fetch = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
    return { fetch, rzp: new HttpRazorpayClient({ keyId: 'rzp_test_abc', keySecret: 'shh', fetch }) };
  }

  it('creates orders in paise and INR with basic auth', async () => {
    const { fetch, rzp } = client();
    await rzp.createOrder({ amountPaise: 4900, receipt: 'HF-48291-VISIT-1a2b3c4d', notes: { bookingId: 'b1' } });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('rzp_test_abc:shh').toString('base64')}`);
    expect(JSON.parse(String(init?.body))).toEqual({ amount: 4900, currency: 'INR', receipt: 'HF-48291-VISIT-1a2b3c4d', notes: { bookingId: 'b1' } });
  });

  it('refunds at normal speed and captures with the amount', async () => {
    const { fetch, rzp } = client(200, { id: 'x', items: [] });
    await rzp.refund('pay_1', { amountPaise: 4900, receipt: 'r', notes: {} });
    await rzp.capture('pay_1', 4900);
    await rzp.fetchOrderPayments('order_1');
    expect(fetch.mock.calls.map(([u]) => String(u))).toEqual([
      'https://api.razorpay.com/v1/payments/pay_1/refund',
      'https://api.razorpay.com/v1/payments/pay_1/capture',
      'https://api.razorpay.com/v1/orders/order_1/payments',
    ]);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ amount: 4900, speed: 'normal' });
  });

  it('turns errors into RazorpayError with the code only', async () => {
    const { rzp } = client(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'contact 9876543210 is invalid' } });
    await expect(rzp.fetchPayment('pay_1')).rejects.toThrow(RazorpayError);
    await expect(rzp.fetchPayment('pay_1')).rejects.toThrow('Razorpay HTTP 400 (BAD_REQUEST_ERROR)');
  });
});
