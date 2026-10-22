// Builds assets/places/india-pincodes.json.gz (states → districts → localities with their PIN codes) from India
// Post's "All India Pincode Directory" CSV (Department of Posts, data.gov.in, Government Open Data License - India).
//
//   node scripts/build-places.mjs <directory.csv> [as-of, e.g. 2024-06]
//
// Columns used: OfficeName, OfficeType, Pincode, District, StateName, Latitude, Longitude. A locality is a post office
// name without its "B.O / S.O / H.O" ending; one locality can have more than one PIN code. A head or sub office (not a
// branch office) is the main locality of its PIN code. India Post's positions are sometimes kilometres off: the app
// trusts the phone's own PIN code first (places.service.ts near).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const [csvPath, asOf = 'unknown'] = process.argv.slice(2);
if (!csvPath) {
  console.error('usage: node scripts/build-places.mjs <directory.csv> [as-of]');
  process.exit(1);
}

/** One CSV line into fields (quoted fields may hold commas). */
function fields(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

const SMALL = new Set(['and', 'of', 'the', 'in']);
/** "MEDCHAL MALKAJGIRI" → "Medchal Malkajgiri"; names already in mixed case stay as they are. */
function tidy(raw, { always = false } = {}) {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!always && s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/(^|[-(.])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()))).join(' ');
}
/** The office type and whatever follows it ("S.O (Ananthapur)", "SO Araria", "B.O"): only repeats the district. */
const OFFICE_TYPE = /(?<=[\s)])(?:B|S|H|P|G\.?\s?P|E\.?\s?D\.?\s?S)\.?\s?O\.?(?=$|[\s(-]).*$/i;
/** "Korremal B.O" → "Korremal", "Agali S.O (Ananthapur)" → "Agali". */
function locality(raw) {
  const s = raw.replace(/\s+/g, ' ').trim().replace(OFFICE_TYPE, '').replace(/[\s.,-]+$/, '');
  return tidy(s);
}
const coord = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 1e4) / 1e4 : null;
};

const text = readFileSync(csvPath, 'utf8').trimStart(); // also drops a byte order mark
const lines = text.split(/\r?\n/).filter(Boolean);
const head = fields(lines[0]).map((h) => h.trim().toLowerCase());
const col = (name) => {
  const i = head.indexOf(name);
  if (i < 0) throw new Error(`column ${name} missing (have ${head.join(', ')})`);
  return i;
};
const C = { office: col('officename'), type: col('officetype'), pin: col('pincode'), district: col('district'), state: col('statename'), lat: col('latitude'), lng: col('longitude') };

/** state → district → locality key → { name, pins, lat, lng } */
const tree = new Map();
let used = 0;
for (const line of lines.slice(1)) {
  const f = fields(line);
  const pin = (f[C.pin] ?? '').trim();
  const name = locality(f[C.office] ?? '');
  const state = tidy(f[C.state] ?? '', { always: true });
  const district = tidy(f[C.district] ?? '', { always: true });
  if (!/^[1-9]\d{5}$/.test(pin) || name.length < 2 || !state || !district) continue;
  used++;
  const districts = tree.get(state) ?? tree.set(state, new Map()).get(state);
  const places = districts.get(district) ?? districts.set(district, new Map()).get(district);
  const key = name.toLowerCase();
  const place = places.get(key) ?? places.set(key, { name, pins: new Set(), lat: null, lng: null, main: false }).get(key);
  place.pins.add(Number(pin));
  if (/^(PO|HO|SO)$/i.test((f[C.type] ?? '').trim())) place.main = true;
  // India's bounding box: anything outside is a typo in the directory.
  const lat = coord(f[C.lat], 6, 37.5);
  const lng = coord(f[C.lng], 68, 97.5);
  if (place.lat === null && lat !== null && lng !== null) Object.assign(place, { lat, lng });
}

const byName = (a, b) => a.localeCompare(b, 'en');
const states = [...tree.keys()].sort(byName).map((state) => [
  state,
  [...tree.get(state).keys()].sort(byName).map((district) => [
    district,
    [...tree.get(state).get(district).values()].sort((a, b) => byName(a.name, b.name)).map((p) => [p.name, [...p.pins].sort(), p.lat, p.lng, p.main ? 1 : 0]),
  ]),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'places', 'india-pincodes.json.gz');
mkdirSync(dirname(out), { recursive: true });
const json = JSON.stringify({ source: 'India Post, All India Pincode Directory (data.gov.in, GODL-India)', asOf, states });
writeFileSync(out, gzipSync(json, { level: 9 }));
const localities = states.reduce((n, [, ds]) => n + ds.reduce((m, [, ps]) => m + ps.length, 0), 0);
console.log(`${used} offices → ${states.length} states, ${states.reduce((n, [, ds]) => n + ds.length, 0)} districts, ${localities} localities; ${(json.length / 1e6).toFixed(1)} MB → ${out}`);
