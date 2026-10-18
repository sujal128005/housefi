// Razorpay's checkout, opened in the phone's secure in-app browser (Custom Tabs / ASWebAuthenticationSession) on
// Housefi's payment page (housefi.tech/pay/). The page runs Razorpay's own checkout with the order the server created;
// UPI apps, cards and net banking all work there. When Razorpay finishes, the page sends the result back to the app
// through the app's link (housefi://pay/return). The app then asks the server to confirm it: nothing is "paid" until
// the server has checked the signature and asked Razorpay itself. No key secret, card or UPI detail touches the app.
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { CheckoutOrder, CheckoutOutcome } from './http/HttpBackend';

export const DEFAULT_CHECKOUT_PAGE = 'https://housefi.tech/pay/';

/** The page's address with the order in the part after "#", which browsers never send to any server. */
export function checkoutUrl(page: string, order: CheckoutOrder, returnUrl: string): string {
  const params = new URLSearchParams({
    k: order.keyId,
    o: order.orderId,
    a: String(Math.round(order.amount * 100)),
    d: order.description,
    r: returnUrl,
  });
  return `${page.replace(/#.*$/, '')}#${params.toString()}`;
}

/** Reads what the payment page sent back. Anything incomplete counts as not paid. */
export function outcomeFrom(url: string, orderId: string): CheckoutOutcome {
  const q = url.split('?')[1]?.split('#')[0] ?? '';
  const p = new URLSearchParams(q);
  const oid = p.get('oid');
  const pid = p.get('pid');
  const sig = p.get('sig');
  if (p.get('status') === 'paid' && oid === orderId && pid && sig) return { kind: 'paid', orderId: oid, paymentId: pid, signature: sig };
  return { kind: 'dismissed' };
}

export function createCheckout(page: string = DEFAULT_CHECKOUT_PAGE) {
  return async function openCheckout(order: CheckoutOrder): Promise<CheckoutOutcome> {
    const returnUrl = Linking.createURL('pay/return');
    const result = await WebBrowser.openAuthSessionAsync(checkoutUrl(page, order, returnUrl), returnUrl);
    return result.type === 'success' ? outcomeFrom(result.url, order.orderId) : { kind: 'dismissed' };
  };
}
