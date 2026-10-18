// Production secrets: writes .env.production (mode 600) from .env.example with every secret Housefi generates
// itself filled in with fresh random values, and the production settings set. Run it once, on the server or a
// trusted laptop, then fill in the keys that come from providers (MSG91, Razorpay, Spaces, Exotel, Anthropic,
// Sarvam, UIDAI) and the database URL. See docs/DEPLOY.md.
//
//   node scripts/prod-secrets.mjs                 # creates .env.production; refuses to overwrite it
//   node scripts/prod-secrets.mjs --rotate-data-key   # adds a new data key version to an existing file
//
// Prints variable names only, never values. Never overwrites a value that is set: replacing the data keys or the
// phone hash key would make stored data unreadable, and new JWT keys would sign everyone out.
import { generateKeyPairSync, randomBytes, randomInt } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = '.env.production';
const b64 = (s) => Buffer.from(s).toString('base64');
const secret = (bytes = 32) => randomBytes(bytes).toString('base64');
/** URL-safe: goes into the Redis URL and the Exotel callback path. */
const token = (bytes) => randomBytes(bytes).toString('base64url');

/** A 6-digit code that is not repeated or sequential digits (the API refuses those). */
function demoCode() {
  for (;;) {
    const c = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const d = [...c].map(Number);
    const steps = d.slice(1).map((x, i) => x - d[i]);
    if (!(steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1))) return c;
  }
}

function parse(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) values.set(m[1], m[2]);
  }
  return values;
}

function setAll(text, updates) {
  const seen = new Set();
  const lines = text.split(/\r?\n/).map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m || !(m[1] in updates)) return line;
    seen.add(m[1]);
    return `${m[1]}=${updates[m[1]]}`;
  });
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) lines.push(`${k}=${v}`);
  return lines.join('\n');
}

if (process.argv.includes('--rotate-data-key')) {
  let text;
  try {
    text = readFileSync(OUT, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${OUT} does not exist`, { cause: e });
    throw e;
  }
  const current = parse(text).get('DATA_KEYS_B64') ?? '';
  const versions = current.split(',').filter(Boolean).map((e) => Number(e.split(':')[0]));
  const next = Math.max(0, ...versions) + 1;
  const keys = [...current.split(',').filter(Boolean), `${next}:${secret()}`].join(',');
  writeFileSync(OUT, setAll(text, { DATA_KEYS_B64: keys, DATA_KEY_ACTIVE: String(next) }), { mode: 0o600 });
  chmodSync(OUT, 0o600);
  console.log(`Added data key version ${next} and made it active. Older versions stay readable; keep them all.`);
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const redisPassword = token(32);
const postgresPassword = token(24);

const generated = {
  JWT_PRIVATE_KEY_B64: b64(privateKey),
  JWT_PUBLIC_KEY_B64: b64(publicKey),
  OTP_PEPPER_B64: secret(),
  TOKEN_PEPPER_B64: secret(),
  PHONE_HASH_KEY_B64: secret(),
  DATA_KEYS_B64: `1:${secret()}`,
  DATA_KEY_ACTIVE: '1',
  EXOTEL_WEBHOOK_SECRET: token(32),
  DEMO_OTP_CODE: demoCode(),
  REDIS_PASSWORD: redisPassword,
  POSTGRES_PASSWORD: postgresPassword,
};
const production = {
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://api.housefi.tech',
  CORS_ORIGINS: 'https://housefi.tech,https://www.housefi.tech',
  TRUST_PROXY: '1',
  // Redis in docker-compose.prod.yml; replace with the managed Redis URL (rediss://) if you use one.
  REDIS_URL: `redis://default:${redisPassword}@redis:6379`,
  // Replace with the Managed PostgreSQL connection string (sslmode=require). This one is the local-db profile.
  DATABASE_URL: `postgresql://housefi:${postgresPassword}@postgres:5432/housefi?schema=public`,
  LOCAL_DATA_KEY_B64: '',
  SMS_PROVIDER: 'msg91',
  PUSH_PROVIDER: 'expo',
  S3_ENDPOINT: 'https://blr1.digitaloceanspaces.com',
  S3_REGION: 'blr1',
  S3_BUCKET_UPLOADS: 'housefi-uploads',
  AADHAAR_REQUIRED: 'true',
};

let text = readFileSync('.env.example', 'utf8')
  .replace(/^# Housefi backend environment\..*\n(#.*\n)*/, '# Housefi production secrets. Keep this file only on the server (chmod 600). Never commit it.\n');
text = setAll(text, { ...production, ...generated });
// 'wx': create only; an existing file is never replaced (it holds keys your data depends on).
try {
  writeFileSync(OUT, text.endsWith('\n') ? text : `${text}\n`, { mode: 0o600, flag: 'wx' });
} catch (e) {
  if (e.code !== 'EEXIST') throw e;
  console.error(`${OUT} already exists. Nothing changed (it would replace keys your data depends on).`);
  process.exit(1);
}
chmodSync(OUT, 0o600);

console.log(`Created ${OUT} (readable by you only) with: ${Object.keys(generated).join(', ')}.`);
console.log('Still to fill in (docs/DEPLOY.md, step 4): DATABASE_URL (managed), DEMO_PHONES, MSG91_*, RAZORPAY_*, S3_ACCESS_KEY_ID,');
console.log('S3_SECRET_ACCESS_KEY, EXPO_ACCESS_TOKEN (if used), EXOTEL_* (when calls go live), ANTHROPIC_API_KEY, SARVAM_API_KEY,');
console.log('UIDAI_QR_CERT_PEM_B64. Back up this file in a password manager: without DATA_KEYS_B64 the stored data cannot be read.');
