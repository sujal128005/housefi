import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv as parseDotEnv } from 'node:util';
import { ConfigError, parseEnv } from './env';

const secret = (bytes = 32) => Buffer.alloc(bytes, 7).toString('base64');
const pem = Buffer.from('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n').toString('base64');

const production = {
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://api.housefi.app',
  JWT_PRIVATE_KEY_B64: pem,
  JWT_PUBLIC_KEY_B64: pem,
  OTP_PEPPER_B64: secret(),
  TOKEN_PEPPER_B64: secret(),
  PHONE_HASH_KEY_B64: secret(),
  KMS_KEY_ID: 'alias/housefi-pii',
  REDIS_URL: 'rediss://default:secret@redis.internal:6379',
  SMS_PROVIDER: 'msg91',
  PUSH_PROVIDER: 'expo',
  S3_BUCKET_UPLOADS: 'housefi-prod-uploads',
  MSG91_AUTH_KEY: 'k',
  MSG91_OTP_TEMPLATE_ID: 't',
  RAZORPAY_KEY_ID: 'rzp_live_x',
  RAZORPAY_KEY_SECRET: 's',
  RAZORPAY_WEBHOOK_SECRET: 'w',
};

function problems(raw: NodeJS.ProcessEnv): readonly string[] {
  try {
    parseEnv(raw);
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
}

describe('parseEnv', () => {
  it('gives defaults that match .env.example and the app rules', () => {
    const env = parseEnv({ NODE_ENV: 'test' });
    expect(env.PORT).toBe(4000);
    expect(env.VISIT_FEE_RUPEES).toBe(49);
    expect(env.OFFER_TIMEOUT_SEC).toBe(45);
    expect(env.OTP_TTL_SEC).toBe(300);
    expect(env.OTP_MAX_ATTEMPTS).toBe(3);
    expect(env.JWT_ACCESS_TTL_SEC).toBe(900);
    expect(env.INSTANT_HOURS).toEqual([7, 21]);
    expect(env.SMS_PROVIDER).toBe('console');
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.TRUST_PROXY).toBe(0);
  });

  describe('the committed .env.example', () => {
    const example = () => parseDotEnv(readFileSync(join(__dirname, '../../.env.example'), 'utf8'));
    const devSecrets = {
      JWT_PRIVATE_KEY_B64: pem, JWT_PUBLIC_KEY_B64: pem, OTP_PEPPER_B64: secret(), TOKEN_PEPPER_B64: secret(),
      PHONE_HASH_KEY_B64: secret(), LOCAL_DATA_KEY_B64: secret(),
    };

    it('works for local development once "npm run setup" has filled the secrets', () => {
      const env = parseEnv({ ...example(), ...devSecrets });
      expect(env.NODE_ENV).toBe('development');
      expect(env.CORS_ORIGINS).toEqual(['http://localhost:8081', 'https://housefi.tech']);
    });

    it('points to "npm run setup" while the secrets are blank', () => {
      const found = problems(example());
      expect(found).toHaveLength(6);
      for (const p of found) expect(p).toMatch(/^[A-Z0-9_]+: required \(run "npm run setup"/);
    });
  });

  it('treats empty values as unset, like the blanks in .env.example', () => {
    const env = parseEnv({ NODE_ENV: 'test', OTP_PEPPER_B64: '', PORT: '', CORS_ORIGINS: 'http://localhost:8081, https://preview.housefi.app' });
    expect(env.OTP_PEPPER_B64).toBeUndefined();
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:8081', 'https://preview.housefi.app']);
  });

  it('accepts a complete production environment', () => {
    expect(problems(production)).toEqual([]);
  });

  it('lists every missing production secret by name, never by value', () => {
    const { OTP_PEPPER_B64: _o, RAZORPAY_WEBHOOK_SECRET: _w, ...rest } = production;
    const found = problems({ ...rest, PUBLIC_BASE_URL: 'http://api.housefi.app' });
    expect(found).toEqual(
      expect.arrayContaining([
        'OTP_PEPPER_B64: required in production',
        'RAZORPAY_WEBHOOK_SECRET: required in production',
        'PUBLIC_BASE_URL: must be https:// in production',
      ]),
    );
    expect(found.join('\n')).not.toContain(production.RAZORPAY_KEY_SECRET + '\n');
  });

  it('rejects the local data key in production', () => {
    expect(problems({ ...production, LOCAL_DATA_KEY_B64: secret() })).toEqual([
      'LOCAL_DATA_KEY_B64: must not be set in production (use DATA_KEYS_B64)',
    ]);
  });

  it('rejects short or non-base64 secrets in any environment', () => {
    const found = problems({ OTP_PEPPER_B64: secret(16), PHONE_HASH_KEY_B64: 'not base64!' });
    expect(found).toEqual(expect.arrayContaining([expect.stringMatching(/^OTP_PEPPER_B64: /), expect.stringMatching(/^PHONE_HASH_KEY_B64: /)]));
  });

  it('allows only Razorpay test keys outside production', () => {
    expect(problems({ NODE_ENV: 'test', RAZORPAY_KEY_ID: 'rzp_live_abc' })).toEqual(['RAZORPAY_KEY_ID: must be a test key (rzp_test_...) outside production']);
    expect(problems({ NODE_ENV: 'test', RAZORPAY_KEY_ID: 'rzp_test_abc' })).toEqual([]);
    expect(problems({ ...production, RAZORPAY_KEY_ID: 'rzp_live_abc' })).toEqual([]);
  });

  it('refuses to print sign-in codes to the log in production', () => {
    expect(problems({ ...production, SMS_PROVIDER: 'console' })).toEqual(['SMS_PROVIDER: must be msg91 in production']);
  });

  it('refuses the development uploads bucket in production', () => {
    expect(problems({ ...production, S3_BUCKET_UPLOADS: 'housefi-dev-uploads' })).toEqual(['S3_BUCKET_UPLOADS: must be the production bucket in production']);
  });

  it('refuses to only log push notifications in production', () => {
    expect(problems({ ...production, PUSH_PROVIDER: 'log' })).toEqual(['PUSH_PROVIDER: must be expo in production']);
  });

  it('requires a 32-byte local data key', () => {
    expect(problems({ NODE_ENV: 'test', LOCAL_DATA_KEY_B64: secret(48) })).toEqual(['LOCAL_DATA_KEY_B64: must be 32 bytes, base64']);
  });

  it('checks the matching timeouts are in order', () => {
    expect(problems({ NODE_ENV: 'test', MATCHING_DELAYED_AFTER_MIN: '30', MATCHING_GIVE_UP_AFTER_MIN: '10' })).toEqual([
      'MATCHING_GIVE_UP_AFTER_MIN: must be greater than MATCHING_DELAYED_AFTER_MIN',
    ]);
  });
});

describe('hardening rules', () => {
  const secret32 = () => Buffer.alloc(32, 9).toString('base64');
  const base = { NODE_ENV: 'test' };
  const problemsOf = (raw: NodeJS.ProcessEnv): readonly string[] => {
    try {
      parseEnv(raw);
      return [];
    } catch (e) {
      return (e as ConfigError).problems;
    }
  };

  it('requires NODE_ENV to be set explicitly', () => {
    expect(problemsOf({})).toEqual([expect.stringMatching(/^NODE_ENV:/)]);
  });

  it('reads TRUST_PROXY as a hop count (true = 1), never as "trust any header"', () => {
    expect(parseEnv({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(1);
    expect(parseEnv({ ...base, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(problemsOf({ ...base, TRUST_PROXY: '9' })).toHaveLength(1);
  });

  it('accepts demo numbers only with a strong demo code', () => {
    expect(parseEnv({ ...base, DEMO_PHONES: '+91 98765 00201, 9876500202', DEMO_OTP_CODE: '482915' }).DEMO_PHONES).toEqual(['9876500201', '9876500202']);
    expect(problemsOf({ ...base, DEMO_PHONES: '9876500202' })).toEqual(['DEMO_OTP_CODE: required when DEMO_PHONES is set']);
    expect(problemsOf({ ...base, DEMO_PHONES: '9876500202', DEMO_OTP_CODE: '123456' })).toEqual([expect.stringMatching(/too easy/)]);
    expect(problemsOf({ ...base, DEMO_PHONES: '12345' , DEMO_OTP_CODE: '482915' })).toHaveLength(1);
  });

  it('takes versioned data keys and needs the active version to exist', () => {
    const env = parseEnv({ ...base, DATA_KEYS_B64: `1:${secret32()},2:${secret32()}`, DATA_KEY_ACTIVE: '2' });
    expect([...(env.DATA_KEYS_B64 ?? new Map()).keys()]).toEqual([1, 2]);
    expect(problemsOf({ ...base, DATA_KEYS_B64: `1:${secret32()}`, DATA_KEY_ACTIVE: '3' })).toEqual([expect.stringMatching(/^DATA_KEY_ACTIVE:/)]);
    expect(problemsOf({ ...base, DATA_KEYS_B64: '1:short' })).toHaveLength(1);
  });

  it('never lets the console SMS sender run in production', () => {
    expect(problemsOf({ NODE_ENV: 'production', SMS_PROVIDER: 'console' })).toContain('SMS_PROVIDER: must be msg91 in production');
  });

  it('needs the Cloudflare account id and token for AI_PROVIDER=cloudflare', () => {
    expect(problemsOf({ ...base, AI_PROVIDER: 'cloudflare' })).toEqual([
      'CLOUDFLARE_ACCOUNT_ID: required when AI_PROVIDER=cloudflare',
      'CLOUDFLARE_AI_TOKEN: required when AI_PROVIDER=cloudflare',
    ]);
    expect(problemsOf({ ...base, AI_PROVIDER: 'cloudflare', CLOUDFLARE_ACCOUNT_ID: 'not-an-id', CLOUDFLARE_AI_TOKEN: 'cf-token' })).toHaveLength(1);
    const env = parseEnv({ ...base, AI_PROVIDER: 'cloudflare', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_AI_TOKEN: 'cf-token' });
    expect(env.CLOUDFLARE_AI_CHAT_MODEL).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(env.SARVAM_STT_MODEL).toBe('saaras:v4');
  });

  it('refuses a password-less Redis in production', () => {
    expect(problemsOf({ NODE_ENV: 'production', REDIS_URL: 'redis://redis:6379' })).toContain('REDIS_URL: must include a password in production (rediss:// recommended)');
  });
});
