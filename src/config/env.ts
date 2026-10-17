// Environment configuration, validated once at startup. Variable names follow .env.example (docs/.env.example).
// Empty values count as "not set". Secrets are required in production and checked for length everywhere; error
// messages name the variable, never its value.
import { z } from 'zod';

const MIN_SECRET_BYTES = 32;

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().int().min(min).max(max).default(def);

/** Base64 secret of at least `MIN_SECRET_BYTES` bytes (OTP / token peppers, HMAC keys, local data key). */
const base64Secret = z
  .string()
  .refine((v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v), 'must be base64')
  .refine((v) => Buffer.from(v, 'base64').length >= MIN_SECRET_BYTES, `must decode to at least ${MIN_SECRET_BYTES} bytes`)
  .optional();

/** Exactly 32 bytes: the local master key for field encryption (AES-256). */
const base64Key32 = z
  .string()
  .refine((v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64')
  .optional();

/** Base64-encoded PEM key (JWT signing keys). */
const base64Pem = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').toString('utf8').includes('-----BEGIN '), 'must be a base64-encoded PEM key')
  .optional();

const csv = z
  .string()
  .default('')
  .transform((v) => v.split(',').map((s) => s.trim()).filter((s) => s.length > 0));

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const hourRange = z
  .string()
  .regex(/^\d{2}-\d{2}$/, 'must look like 07-21')
  .default('07-21')
  .transform((v) => v.split('-').map(Number) as [number, number])
  .refine(([a, b]) => a >= 0 && b <= 24 && a < b, 'start must be before end, within 00-24');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(4000, 1, 65535),
    PUBLIC_BASE_URL: z.url().default('http://localhost:4000'),
    CORS_ORIGINS: csv,
    /** Set when running behind a load balancer so req.ip is the client, not the proxy. */
    TRUST_PROXY: bool,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Default per-IP limit for every route without its own @RateLimit. */
    RATE_LIMIT_PER_MIN: int(120, 1),

    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// URL').default('postgresql://housefi:housefi@localhost:5432/housefi?schema=public'),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL').default('redis://localhost:6379'),

    JWT_PRIVATE_KEY_B64: base64Pem,
    JWT_PUBLIC_KEY_B64: base64Pem,
    JWT_ACCESS_TTL_SEC: int(900, 60),
    REFRESH_TOKEN_TTL_DAYS: int(30, 1),
    OTP_PEPPER_B64: base64Secret,
    TOKEN_PEPPER_B64: base64Secret,
    OTP_TTL_SEC: int(300, 30),
    OTP_MAX_ATTEMPTS: int(3, 1),
    OTP_RESEND_AFTER_SEC: int(30, 0),

    KMS_KEY_ID: z.string().optional(),
    LOCAL_DATA_KEY_B64: base64Key32,
    PHONE_HASH_KEY_B64: base64Secret,

    /** console = print codes to the server log (development only); msg91 = send real SMS. */
    SMS_PROVIDER: z.enum(['console', 'msg91']).default('console'),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_OTP_TEMPLATE_ID: z.string().optional(),
    MSG91_SENDER_ID: z.string().default('HOUSFI'),

    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    AWS_REGION: z.string().default('ap-south-1'),
    S3_BUCKET_UPLOADS: z.string().default('housefi-dev-uploads'),
    S3_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    UPLOAD_URL_TTL_SEC: int(300, 30),

    /** log = write pushes to the server log (development, tests); expo = send through the Expo push service. */
    PUSH_PROVIDER: z.enum(['log', 'expo']).default('log'),
    /** Optional: required only when "enhanced push security" is turned on in the Expo project. */
    EXPO_ACCESS_TOKEN: z.string().optional(),

    EXOTEL_SID: z.string().optional(),
    EXOTEL_API_KEY: z.string().optional(),
    EXOTEL_API_TOKEN: z.string().optional(),
    EXOTEL_CALLER_ID: z.string().optional(),

    ANTHROPIC_API_KEY: z.string().optional(),
    AI_CHAT_MODEL: z.string().default('claude-sonnet-5-5'),
    SPEECH_TO_TEXT_PROVIDER: z.string().optional(),

    VISIT_FEE_RUPEES: int(49, 1),
    QUOTE_MIN_RUPEES: int(100, 1),
    TECH_VISIT_SHARE_RUPEES: int(30, 0),
    TECH_LABOUR_SHARE_PERCENT: int(80, 0, 100),
    OFFER_TIMEOUT_SEC: int(45, 5),
    MATCHING_DELAYED_AFTER_MIN: int(10, 1),
    MATCHING_GIVE_UP_AFTER_MIN: int(30, 1),
    UNPAID_BOOKING_EXPIRY_MIN: int(30, 1),
    INSTANT_HOURS: hourRange,
    /** Bookings per 2-hour window per category in one PIN area, unless slot_capacities says otherwise. */
    SLOT_CAPACITY_PER_WINDOW: int(10, 0),
    START_CODE_MAX_ATTEMPTS: int(5, 1),
  })
  .superRefine((e, ctx) => {
    const require = (key: keyof typeof e, why: string) => {
      if (e[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: `required ${why}` });
    };
    const authSecrets = ['JWT_PRIVATE_KEY_B64', 'JWT_PUBLIC_KEY_B64', 'OTP_PEPPER_B64', 'TOKEN_PEPPER_B64', 'PHONE_HASH_KEY_B64'] as const;
    if (e.NODE_ENV === 'development') {
      for (const k of authSecrets) require(k, '(run "npm run setup" to generate local secrets)');
      if (e.LOCAL_DATA_KEY_B64 === undefined && e.KMS_KEY_ID === undefined) {
        require('LOCAL_DATA_KEY_B64', '(run "npm run setup" to generate local secrets)');
      }
    }
    if (e.NODE_ENV === 'production') {
      const keys = [
        ...authSecrets, 'KMS_KEY_ID', 'MSG91_AUTH_KEY', 'MSG91_OTP_TEMPLATE_ID', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
        'RAZORPAY_WEBHOOK_SECRET',
      ] as const;
      for (const k of keys) require(k, 'in production');
      if (e.LOCAL_DATA_KEY_B64 !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['LOCAL_DATA_KEY_B64'], message: 'must not be set in production (use KMS_KEY_ID)' });
      }
      if (e.SMS_PROVIDER !== 'msg91') {
        ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'must be msg91 in production' });
      }
      if (e.S3_BUCKET_UPLOADS === 'housefi-dev-uploads') {
        ctx.addIssue({ code: 'custom', path: ['S3_BUCKET_UPLOADS'], message: 'must be the production bucket in production' });
      }
      if (e.PUSH_PROVIDER !== 'expo') {
        ctx.addIssue({ code: 'custom', path: ['PUSH_PROVIDER'], message: 'must be expo in production' });
      }
      if (!e.PUBLIC_BASE_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'must be https:// in production' });
      }
    }
    // Live Razorpay keys move real money: only production may use them.
    if (e.NODE_ENV !== 'production' && e.RAZORPAY_KEY_ID !== undefined && !e.RAZORPAY_KEY_ID.startsWith('rzp_test_')) {
      ctx.addIssue({ code: 'custom', path: ['RAZORPAY_KEY_ID'], message: 'must be a test key (rzp_test_...) outside production' });
    }
    if (e.MATCHING_GIVE_UP_AFTER_MIN <= e.MATCHING_DELAYED_AFTER_MIN) {
      ctx.addIssue({ code: 'custom', path: ['MATCHING_GIVE_UP_AFTER_MIN'], message: 'must be greater than MATCHING_DELAYED_AFTER_MIN' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Parses the environment. Throws ConfigError listing every bad variable (names and rules only, no values). */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  return result.data;
}
