// UIDAI certificates for Aadhaar Secure QR checks: reads every certificate in a folder (the .cer files downloaded from
// uidai.gov.in, DER or PEM), shows what each one is, and sets UIDAI_QR_CERT_PEM_B64 in .env.production to all of them
// (comma-separated). Nothing else in the file changes. The certificates are public, not secrets.
//
//   node scripts/uidai-certs.mjs <folder>      (on the laptop: deploy\laptop uidai <folder>)
//
// Then restart the API (deploy\laptop start) so it reads the new value.
import { X509Certificate } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.env.production';
const KEY = 'UIDAI_QR_CERT_PEM_B64';
const folder = process.argv[2];
if (!folder) {
  console.error('usage: node scripts/uidai-certs.mjs <folder with the UIDAI .cer files>');
  process.exit(2);
}

const found = [];
const seen = new Set();
for (const name of readdirSync(folder).sort()) {
  if (!/\.(cer|crt|pem)$/i.test(name)) continue;
  const raw = readFileSync(join(folder, name));
  let cert;
  try {
    cert = new X509Certificate(raw);
  } catch {
    console.log(`  skipped ${name}: not a certificate`);
    continue;
  }
  if (seen.has(cert.fingerprint256)) {
    console.log(`  skipped ${name}: the same certificate as another file`);
    continue;
  }
  seen.add(cert.fingerprint256);
  const subject = (cert.subject.match(/CN=([^\n]+)/) ?? [])[1] ?? cert.subject.replace(/\n/g, ', ');
  const expired = new Date(cert.validTo) < new Date() ? '  (expired: still used for Aadhaar printed while it was valid)' : '';
  console.log(`  ${name}: ${subject}, valid ${new Date(cert.validFrom).toISOString().slice(0, 10)} to ${new Date(cert.validTo).toISOString().slice(0, 10)}${expired}`);
  found.push(raw.toString('base64'));
}
if (found.length === 0) {
  console.error(`No certificates (.cer, .crt or .pem) in ${folder}. Nothing changed.`);
  process.exit(1);
}

let text;
try {
  text = readFileSync(OUT, 'utf8');
} catch (e) {
  if (e.code === 'ENOENT') throw new Error(`${OUT} does not exist (run this in the backend folder)`, { cause: e });
  throw e;
}
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const line = `${KEY}=${found.join(',')}`;
const lines = text.split(/\r?\n/);
const at = lines.findIndex((l) => l.startsWith(`${KEY}=`));
if (at >= 0) lines[at] = line;
else lines.splice(lines.at(-1) === '' ? -1 : lines.length, 0, line);
writeFileSync(OUT, lines.join(eol));
console.log(`Set ${KEY} in ${OUT} to ${found.length} certificate(s). Restart the API to use them (deploy\\laptop start).`);
