// Local development setup: creates .env from .env.example and fills in the secrets that are blank with fresh random
// values (Ed25519 JWT key pair, OTP / token peppers, phone HMAC key, local data-encryption key).
// Never overwrites a value that is already set: changing the data key or phone key would make existing local data
// unreadable. Prints variable names only, never values.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const ENV = '.env';

if (!existsSync(ENV)) {
  copyFileSync('.env.example', ENV);
  console.log('Created .env from .env.example');
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const b64 = (s) => Buffer.from(s).toString('base64');

const generated = {
  JWT_PRIVATE_KEY_B64: b64(privateKey),
  JWT_PUBLIC_KEY_B64: b64(publicKey),
  OTP_PEPPER_B64: randomBytes(32).toString('base64'),
  TOKEN_PEPPER_B64: randomBytes(32).toString('base64'),
  PHONE_HASH_KEY_B64: randomBytes(32).toString('base64'),
  LOCAL_DATA_KEY_B64: randomBytes(32).toString('base64'),
};

const lines = readFileSync(ENV, 'utf8').split(/\r?\n/);
const filled = [];
const present = new Set();
const out = lines.map((line) => {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m || !(m[1] in generated)) return line;
  present.add(m[1]);
  if (m[2].trim() !== '') return line;
  // Both JWT keys are generated together; only fill them as a pair.
  filled.push(m[1]);
  return `${m[1]}=${generated[m[1]]}`;
});
for (const name of Object.keys(generated)) {
  if (!present.has(name)) {
    out.push(`${name}=${generated[name]}`);
    filled.push(name);
  }
}

const jwt = ['JWT_PRIVATE_KEY_B64', 'JWT_PUBLIC_KEY_B64'];
if (filled.some((n) => jwt.includes(n)) && !jwt.every((n) => filled.includes(n))) {
  console.error('Only one of the JWT keys is set in .env. Clear both and run "npm run setup" again.');
  process.exit(1);
}

writeFileSync(ENV, out.join('\n'));
console.log(filled.length ? `Generated: ${filled.join(', ')}` : 'All local secrets were already set; nothing changed.');
