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

/** 10-digit Indian mobile numbers (no +91), comma-separated. */
const phoneList = z
  .string()
  .default('')
  .transform((v) => v.split(',').map((s) => s.replace(/[\s-]/g, '').replace(/^(\+?91)(?=[6-9]\d{9}$)/, '')).filter((s) => s.length > 0))
  .refine((list) => list.every((p) => /^[6-9]\d{9}$/.test(p)), 'must be 10-digit Indian mobile numbers, comma-separated');

/**
 * Number of reverse proxies in front of the API whose X-Forwarded-For entries are trusted (0 = none). Only the
 * entries those proxies appended are believed, so a client cannot choose its own IP by sending the header.
 * "true" means 1 and "false" means 0, for older .env files.
 */
const proxyHops = z
  .string()
  .default('0')
  .transform((v) => (v === 'true' ? 1 : v === 'false' ? 0 : Number(v)))
  .pipe(z.number().int().min(0).max(3));

/**
 * Versioned master keys for field encryption without a cloud KMS: "1:<base64 32 bytes>,2:<base64 32 bytes>".
 * New values use DATA_KEY_ACTIVE; older versions stay readable, so keys can be rotated.
 */
const dataKeys = z
  .string()
  .transform((v, ctx) => {
    const out = new Map<number, string>();
    for (const part of v.split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = /^(\d{1,3}):([A-Za-z0-9+/]+={0,2})$/.exec(part);
      if (!m || Buffer.from(m[2] as string, 'base64').length !== 32 || Number(m[1]) < 1 || Number(m[1]) > 255) {
        ctx.addIssue({ code: 'custom', message: 'each entry must be <version 1-255>:<32 bytes base64>' });
        return z.NEVER;
      }
      if (out.has(Number(m[1]))) {
        ctx.addIssue({ code: 'custom', message: 'duplicate key version' });
        return z.NEVER;
      }
      out.set(Number(m[1]), m[2] as string);
    }
    return out;
  })
  .optional();

/** "5:10m,3:1h,1:24h,1:21d" → steps of { failures, lockSec }. Units: s, m, h, d. */
const lockSteps = z
  .string()
  .default('5:10m,3:1h,1:24h,1:21d')
  .transform((v, ctx) => {
    const unit: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
    const steps = v.split(',').map((part) => /^\s*(\d{1,2}):(\d{1,4})([smhd])\s*$/.exec(part));
    if (steps.length === 0 || steps.some((m) => !m || Number(m[1]) < 1)) {
      ctx.addIssue({ code: 'custom', message: 'must look like 5:10m,3:1h,1:24h,1:21d' });
      return z.NEVER;
    }
    return steps.map((m) => ({ failures: Number(m![1]), lockSec: Number(m![2]) * (unit[m![3] as string] as number) }));
  });

const hourRange = z
  .string()
  .regex(/^\d{2}-\d{2}$/, 'must look like 07-21')
  .default('07-21')
  .transform((v) => v.split('-').map(Number) as [number, number])
  .refine(([a, b]) => a >= 0 && b <= 24 && a < b, 'start must be before end, within 00-24');

export const envSchema = z
  .object({
    /** Required: a deployment that forgets it must not silently run with development behaviour. */
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: int(4000, 1, 65535),
    PUBLIC_BASE_URL: z.url().default('http://localhost:4000'),
    CORS_ORIGINS: csv,
    /** Reverse proxies (load balancer, Cloudflare) in front of the API: 1 behind one load balancer. See proxyHops. */
    TRUST_PROXY: proxyHops,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Default per-IP limit for every route without its own @RateLimit. */
    RATE_LIMIT_PER_MIN: int(120, 1),

    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// URL').default('postgresql://housefi:housefi@localhost:5432/housefi?schema=public'),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL').default('redis://localhost:6379'),

    JWT_PRIVATE_KEY_B64: base64Pem,
    JWT_PUBLIC_KEY_B64: base64Pem,
    JWT_ACCESS_TTL_SEC: int(900, 60, 3600),
    REFRESH_TOKEN_TTL_DAYS: int(30, 1, 90),
    OTP_PEPPER_B64: base64Secret,
    TOKEN_PEPPER_B64: base64Secret,
    OTP_TTL_SEC: int(300, 30, 900),
    OTP_MAX_ATTEMPTS: int(3, 1, 5),
    OTP_RESEND_AFTER_SEC: int(30, 0, 300),
    /**
     * Sign-in SMS budget for the whole service, counted in the database (holds when Redis is down). Past it, new
     * codes are refused and an alert is logged: a flood of requests cannot drain the SMS balance.
     */
    OTP_SMS_PER_MINUTE: int(60, 1),
    OTP_SMS_PER_HOUR: int(1000, 1),
    OTP_SMS_PER_DAY: int(8000, 1),
    /**
     * Progressive sign-in lock per phone number, counted across all its codes: "wrong codes:lock" steps. Default: 5
     * wrong codes lock sign-in for 10 minutes, 3 more for 1 hour, 1 more for 24 hours, 1 more for 21 days (the account
     * is locked; support can unlock it). A correct code resets the count; so do 30 days without a wrong code.
     */
    OTP_LOCK_STEPS: lockSteps,

    /**
     * Team demo accounts: these numbers (and only these) sign in with DEMO_OTP_CODE instead of an SMS. Their
     * bookings use simulated payments and only reach demo technicians; real customers and technicians never see them.
     */
    DEMO_PHONES: phoneList,
    DEMO_OTP_CODE: z.string().regex(/^[0-9]{6}$/, 'must be 6 digits').optional(),

    /** Optional: AWS KMS key. Without a cloud KMS, production uses DATA_KEYS_B64 (kept in the host's secret store). */
    KMS_KEY_ID: z.string().optional(),
    DATA_KEYS_B64: dataKeys,
    DATA_KEY_ACTIVE: z.coerce.number().int().min(1).max(255).optional(),
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

    /** Region of the S3-compatible storage (DigitalOcean Spaces: blr1; AWS: ap-south-1). */
    AWS_REGION: z.string().default('ap-south-1'),
    S3_REGION: z.string().optional(),
    S3_BUCKET_UPLOADS: z.string().default('housefi-dev-uploads'),
    S3_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    UPLOAD_URL_TTL_SEC: int(300, 30),

    /** log = write pushes to the server log (development, tests); expo = send through the Expo push service. */
    PUSH_PROVIDER: z.enum(['log', 'expo']).default('log'),
    /** Optional: required only when "enhanced push security" is turned on in the Expo project. */
    EXPO_ACCESS_TOKEN: z.string().optional(),

    /**
     * Phone calls (docs/TELEPHONY.md): off = no calls (keypad technicians are served by coordinators); exotel = real
     * calls; fake = recorded only (development and tests).
     */
    TELEPHONY_PROVIDER: z.enum(['off', 'fake', 'exotel']).default('off'),
    EXOTEL_SID: z.string().optional(),
    EXOTEL_API_KEY: z.string().optional(),
    EXOTEL_API_TOKEN: z.string().optional(),
    /** api.exotel.com (Singapore cluster) or api.in.exotel.com (Mumbai cluster), as on the Exotel dashboard. */
    EXOTEL_SUBDOMAIN: z.string().regex(/^[a-z0-9.-]+$/).default('api.in.exotel.com'),
    /** The Housefi ExoPhone: caller ID for every call, and the number customers and technicians dial for masked calls. */
    EXOTEL_CALLER_ID: z.string().regex(/^\+?[0-9]{8,15}$/).optional(),
    /** The Exotel app (call flow) that plays a job offer and collects the keypresses. */
    EXOTEL_OFFER_FLOW_ID: z.string().regex(/^[0-9]+$/).optional(),
    /** Secret part of the callback URLs Exotel calls (at least 32 characters). */
    EXOTEL_WEBHOOK_SECRET: z.string().min(32).optional(),
    /** Optional: only these addresses may call the telephony callbacks (Exotel's published IPs). */
    TELEPHONY_ALLOWED_IPS: csv,
    /** A job offer by phone call lasts this long (ringing plus the spoken offer). */
    IVR_OFFER_TIMEOUT_SEC: int(90, 30, 600),
    /** How long the phone rings before the call counts as not answered. */
    IVR_RING_TIMEOUT_SEC: int(30, 10, 120),
    /** Calls that fail to be placed in a row before calling pauses (circuit breaker), and for how long. */
    IVR_CIRCUIT_FAILURES: int(3, 1, 20),
    IVR_CIRCUIT_OPEN_MIN: int(5, 1, 120),
    /** How long a masked-call permission lasts after the app asks for it. */
    MASKED_CALL_GRANT_MIN: int(30, 5, 240),
    /** MSG91 template (DLT approved) for the job details SMS after a phone acceptance. Optional. */
    MSG91_JOB_TEMPLATE_ID: z.string().optional(),

    /**
     * The support chat and the problem-photo reader: "rules" (no model, the v1 behaviour), "anthropic" (Claude) or
     * "cloudflare" (open models on Cloudflare Workers AI, free daily allowance), each with the rules as the fallback
     * whenever the model is slow, unavailable or declines.
     */
    AI_PROVIDER: z.enum(['rules', 'anthropic', 'cloudflare']).default('rules'),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_CHAT_MODEL: z.string().default('claude-opus-5-5'),
    AI_VISION_MODEL: z.string().default('claude-opus-5-5'),
    /** Cloudflare Workers AI (AI_PROVIDER=cloudflare): account id and an API token with Workers AI read + edit. */
    CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[0-9a-f]{32}$/, 'must be the 32-character account id').optional(),
    CLOUDFLARE_AI_TOKEN: z.string().optional(),
    CLOUDFLARE_AI_CHAT_MODEL: z.string().default('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
    CLOUDFLARE_AI_VISION_MODEL: z.string().default('@cf/meta/llama-4-scout-17b-16e-instruct'),
    /** Per model call; past it the rules answer instead. */
    AI_TIMEOUT_MS: int(15000, 2000, 60000),
    /** Voice notes to text: "none" (the app keeps the audio) or "sarvam" (Sarvam AI, Telugu and English). */
    SPEECH_TO_TEXT_PROVIDER: z.enum(['none', 'sarvam']).default('none'),
    SARVAM_API_KEY: z.string().optional(),
    SARVAM_STT_MODEL: z.string().default('saaras:v4'),

    /**
     * Where the QR code on a Technician ID card points; the token is appended. The default page on the Housefi website
     * reads the token after "#", so it never reaches any server log.
     */
    VERIFY_PAGE_URL: z.url().default('https://housefi.tech/t/#'),
    /** UIDAI's certificate for Aadhaar Secure QR signatures (PEM, base64). Without it Aadhaar checks are unavailable. */
    UIDAI_QR_CERT_PEM_B64: z.string().optional(),
    /** Technicians need a verified Aadhaar (Secure QR) before they can be approved. */
    AADHAAR_REQUIRED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

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
      if (e.LOCAL_DATA_KEY_B64 === undefined && e.KMS_KEY_ID === undefined && e.DATA_KEYS_B64 === undefined) {
        require('LOCAL_DATA_KEY_B64', '(run "npm run setup" to generate local secrets)');
      }
    }
    if (e.DATA_KEYS_B64 !== undefined) {
      if (e.DATA_KEY_ACTIVE === undefined || !e.DATA_KEYS_B64.has(e.DATA_KEY_ACTIVE)) {
        ctx.addIssue({ code: 'custom', path: ['DATA_KEY_ACTIVE'], message: 'must name one of the versions in DATA_KEYS_B64' });
      }
    }
    // The console sender writes sign-in codes to the log: only on a developer's machine or in tests.
    if (e.SMS_PROVIDER === 'console' && e.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'must be msg91 in production' });
    }
    if (e.DEMO_PHONES.length > 0 && e.DEMO_OTP_CODE === undefined) {
      ctx.addIssue({ code: 'custom', path: ['DEMO_OTP_CODE'], message: 'required when DEMO_PHONES is set' });
    }
    if (e.DEMO_OTP_CODE !== undefined && weakCode(e.DEMO_OTP_CODE)) {
      ctx.addIssue({ code: 'custom', path: ['DEMO_OTP_CODE'], message: 'too easy to guess (repeated or sequential digits)' });
    }
    if (e.AI_PROVIDER === 'anthropic') require('ANTHROPIC_API_KEY', 'when AI_PROVIDER=anthropic');
    if (e.AI_PROVIDER === 'cloudflare') {
      require('CLOUDFLARE_ACCOUNT_ID', 'when AI_PROVIDER=cloudflare');
      require('CLOUDFLARE_AI_TOKEN', 'when AI_PROVIDER=cloudflare');
    }
    if (e.SPEECH_TO_TEXT_PROVIDER === 'sarvam') require('SARVAM_API_KEY', 'when SPEECH_TO_TEXT_PROVIDER=sarvam');
    if (e.TELEPHONY_PROVIDER === 'exotel') {
      for (const k of ['EXOTEL_SID', 'EXOTEL_API_KEY', 'EXOTEL_API_TOKEN', 'EXOTEL_CALLER_ID', 'EXOTEL_OFFER_FLOW_ID', 'EXOTEL_WEBHOOK_SECRET'] as const) {
        require(k, 'when TELEPHONY_PROVIDER=exotel');
      }
    }
    if (e.TELEPHONY_PROVIDER === 'fake' && e.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['TELEPHONY_PROVIDER'], message: 'must be exotel or off in production' });
    }
    if (e.NODE_ENV === 'production') {
      const keys = [
        ...authSecrets, 'MSG91_AUTH_KEY', 'MSG91_OTP_TEMPLATE_ID', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
        'RAZORPAY_WEBHOOK_SECRET',
      ] as const;
      for (const k of keys) require(k, 'in production');
      if (e.KMS_KEY_ID === undefined && e.DATA_KEYS_B64 === undefined) {
        ctx.addIssue({ code: 'custom', path: ['DATA_KEYS_B64'], message: 'required in production (or KMS_KEY_ID)' });
      }
      if (e.LOCAL_DATA_KEY_B64 !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['LOCAL_DATA_KEY_B64'], message: 'must not be set in production (use DATA_KEYS_B64)' });
      }
      // Redis holds rate limits and live updates: never an open, password-less server.
      if (!/^rediss?:\/\/[^/@]*:[^/@]+@/.test(e.REDIS_URL)) {
        ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'must include a password in production (rediss:// recommended)' });
      }
      if (e.OTP_RESEND_AFTER_SEC < 15) {
        ctx.addIssue({ code: 'custom', path: ['OTP_RESEND_AFTER_SEC'], message: 'must be at least 15 in production' });
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

/** 000000, 111111, 123456, 654321 and the like. */
function weakCode(code: string): boolean {
  const d = [...code].map(Number);
  const steps = d.slice(1).map((x, i) => x - (d[i] as number));
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

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
