// Razorpay signature checks. Both are HMAC-SHA256, hex-encoded, compared in constant time.
import { createHmac, timingSafeEqual } from 'node:crypto';

function hexEqual(expectedHex: string, givenHex: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(givenHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(givenHex, 'hex'));
}

/** Checkout success: signature = HMAC(key_secret, `${order_id}|${payment_id}`). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  const expected = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return hexEqual(expected, signature);
}

/** Webhooks: X-Razorpay-Signature = HMAC(webhook_secret, raw request body). */
export function verifyWebhookSignature(rawBody: Buffer, signature: string, webhookSecret: string): boolean {
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return hexEqual(expected, signature);
}
