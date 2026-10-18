import type { PaymentMethod } from '../domain/types';
import type { IconName } from './Icon';

/** Payment methods offered on screen. Cash is only for the final bill (paid to the technician). */
export const PAY_METHODS: readonly { readonly method: PaymentMethod; readonly icon: IconName }[] = [
  { method: 'UPI', icon: 'phone-portrait-outline' },
  { method: 'CARD', icon: 'card-outline' },
  { method: 'NETBANKING', icon: 'business-outline' },
  { method: 'CASH', icon: 'cash-outline' },
];

export const VISIT_METHODS = PAY_METHODS.filter((m) => m.method !== 'CASH');
