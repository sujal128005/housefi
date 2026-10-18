// Reads the sign-in code from the SMS so people don't have to type it.
// - Every platform: the code field is marked as a one-time code (textContentType / autoComplete), so iOS and Android
//   keyboards offer the code from the message with one tap.
// - Web (Chrome on Android): the Web OTP API reads the code by itself when the SMS ends with "@<domain> #<code>".
// - Demo mode: the demo "SMS" arrives on screen after a moment and its code fills itself in.
// The live backend's SMS format (for the Android SMS Retriever and Web OTP) is in docs/backend.
import { Platform } from 'react-native';

/** Stops listening. */
export type StopListening = () => void;

interface OtpCredential {
  readonly code?: string;
}

/** Listens for a code arriving by SMS; calls `onCode` once with the digits. */
export function listenForOtp(onCode: (code: string) => void, { demoCode, delayMs = 1400 }: { readonly demoCode?: string | null; readonly delayMs?: number } = {}): StopListening {
  let stopped = false;
  const deliver = (code: string | undefined) => {
    const digits = (code ?? '').replace(/\D/g, '');
    if (!stopped && digits.length > 0) {
      stopped = true;
      onCode(digits);
    }
  };

  if (demoCode) {
    const id = setTimeout(() => deliver(demoCode), delayMs);
    return () => {
      stopped = true;
      clearTimeout(id);
    };
  }

  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && typeof AbortController !== 'undefined' && 'OTPCredential' in globalThis) {
    const abort = new AbortController();
    const request = { otp: { transport: ['sms'] }, signal: abort.signal } as unknown as CredentialRequestOptions;
    navigator.credentials
      ?.get(request)
      .then((c) => deliver((c as OtpCredential | null)?.code))
      .catch(() => undefined);
    return () => {
      stopped = true;
      abort.abort();
    };
  }

  return () => {
    stopped = true;
  };
}
