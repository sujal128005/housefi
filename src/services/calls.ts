// Phone calls from the app. Customer ↔ technician calls are masked: the API returns Housefi's number, and dialling it
// within a few minutes connects to the other person without either side seeing the other's real number. When calls
// are not available (outside the visit, or phone calls switched off on the server), the person gets a call back from
// Housefi instead, so the button never leads nowhere.
import { Linking, Platform } from 'react-native';
import { isApiError, type Backend } from './api';

export type CallOutcome = 'DIALLING' | 'CALLBACK' | 'NOT_NOW' | 'FAILED';

/** Opens the phone's dialler with the number (only digits and a leading +). */
export async function dial(number: string): Promise<boolean> {
  const clean = number.replace(/[^\d+]/g, '');
  if (!clean || Platform.OS === 'web') return false;
  try {
    await Linking.openURL(`tel:${clean}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts a masked call. `getNumber` asks the API for the number (bookings.call / tech.callCustomer). CONFLICT means
 * it is not the time for a call (before assignment, after payment): NOT_NOW. Any other failure asks for a call back.
 */
export async function maskedCall(backend: Backend, token: string, bookingId: string, getNumber: () => Promise<{ readonly dialNumber: string }>): Promise<CallOutcome> {
  try {
    const { dialNumber } = await getNumber();
    if (await dial(dialNumber)) return 'DIALLING';
  } catch (e) {
    if (isApiError(e, 'CONFLICT') || isApiError(e, 'NOT_FOUND')) return 'NOT_NOW';
  }
  try {
    await backend.support.callback(token, bookingId, 'call request from the app');
    return 'CALLBACK';
  } catch {
    return 'FAILED';
  }
}

/** Housefi customer care's number, from the build (EXPO_PUBLIC_HOUSEFI_SUPPORT_PHONE); null when not set. */
export const SUPPORT_PHONE: string | null = (process.env.EXPO_PUBLIC_HOUSEFI_SUPPORT_PHONE ?? '').trim() || null;
