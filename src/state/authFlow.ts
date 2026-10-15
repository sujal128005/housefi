// Hands the OTP challenge from the phone screen to the code screen without putting it in the route.
import type { OtpChallenge } from '../services/api';

let pending: OtpChallenge | null = null;

export const authFlow = {
  set(c: OtpChallenge | null): void {
    pending = c;
  },
  get(): OtpChallenge | null {
    return pending;
  },
};
