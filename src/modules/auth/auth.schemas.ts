// Request bodies for /auth, mirroring openapi.yaml.
import { z } from 'zod';

export const OtpRequestBody = z.object({
  /** 10-digit Indian mobile, without +91. */
  phone: z.string().regex(/^[6-9][0-9]{9}$/),
  /** COORDINATOR (an addition to the contract) only signs in to accounts made with `npm run coordinators`. */
  role: z.enum(['CUSTOMER', 'TECHNICIAN', 'COORDINATOR']),
});

export const OtpVerifyBody = z.object({
  challengeId: z.string().min(1).max(64),
  code: z.string().regex(/^[0-9]{6}$/),
});

export const RefreshBody = z.object({
  refreshToken: z.string().min(1).max(256),
});

export const LogoutBody = z
  .object({ refreshToken: z.string().min(1).max(256).optional() })
  .optional()
  .transform((b) => b ?? {});
