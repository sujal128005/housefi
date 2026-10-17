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
  SMS_PROVIDER: 'msg91',
  PUSH_PROVIDER: 'expo',
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
    expect(env.TRUST_PROXY).toBe(false);
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
      expect(env.CORS_ORIGINS).toEqual(['http://localhost:8081']);
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
      'LOCAL_DATA_KEY_B64: must not be set in production (use KMS_KEY_ID)',
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
