// What is inside an uploaded file, checked from its bytes (never from what the app says): the real type, the length
// of a voice note, and removing location data from photos (README security checklist: "strip EXIF location").
// Pure functions without native dependencies. Location is removed in place: the GPS block of the EXIF data is
// zeroed (orientation and the rest stay, so photos do not turn sideways) and XMP metadata, which can repeat the
// location, is dropped (JPEG, PNG) or blanked (HEIC).
import { crc32 } from 'node:zlib';

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/heic'] as const;
export const AUDIO_TYPES = ['audio/m4a', 'audio/mp4', 'audio/aac'] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];
export type AudioType = (typeof AUDIO_TYPES)[number];

/** A file that is not what it claims to be, or that cannot be read safely. */
export class MediaError extends Error {}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const startsWith = (b: Uint8Array, sig: readonly number[]) => sig.every((v, i) => b[i] === v);

function need(cond: boolean, what: string): asserts cond {
  if (!cond) throw new MediaError(what);
}

// ---------- ISO base media (HEIC, M4A) ----------

interface Box {
  readonly type: string;
  /** Offset of the box header. */
  readonly start: number;
  /** Offset of the payload (after size, type and any large size). */
  readonly body: number;
  readonly end: number;
}

/** The boxes between `from` and `to` (one level). */
function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(b, at);
    const type = ascii(b, at + 4, 4);
    let body = at + 8;
    if (size === 1) {
      need(at + 16 <= to, 'truncated box');
      const hi = u32(b, at + 8);
      need(hi === 0, 'box too large');
      size = u32(b, at + 12);
      body = at + 16;
    } else if (size === 0) size = to - at;
    need(size >= body - at && at + size <= to, `bad ${type} box`);
    out.push({ type, start: at, body, end: at + size });
    at += size;
  }
  return out;
}

const child = (b: Uint8Array, parent: Box, type: string, fullBox = false) => boxes(b, parent.body + (fullBox ? 4 : 0), parent.end).find((x) => x.type === type);

function ftypBrands(b: Uint8Array): string[] | null {
  if (b.length < 12 || ascii(b, 4, 4) !== 'ftyp') return null;
  const size = u32(b, 0);
  if (size < 16 || size > b.length) return null;
  const brands = [ascii(b, 8, 4)];
  for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(b, at, 4));
  return brands;
}

// ---------- type checks ----------

/** True when the bytes really are `type` (magic numbers; HEIC and M4A by their ftyp brands). */
export function isType(b: Uint8Array, type: PhotoType | AudioType): boolean {
  switch (type) {
    case 'image/jpeg':
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/heic': {
      const brands = ftypBrands(b);
      return !!brands && brands.some((x) => HEIF_BRANDS.has(x));
    }
    case 'audio/m4a':
    case 'audio/mp4': {
      const brands = ftypBrands(b);
      return !!brands && !brands.some((x) => HEIF_BRANDS.has(x));
    }
    case 'audio/aac':
      return adtsStart(b) !== null;
  }
}

/** Where ADTS frames start (after an optional ID3 tag), or null. */
function adtsStart(b: Uint8Array): number | null {
  let at = 0;
  if (b.length >= 10 && ascii(b, 0, 3) === 'ID3') at = 10 + (((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f));
  return at + 7 <= b.length && b[at] === 0xff && (b[at + 1]! & 0xf6) === 0xf0 ? at : null;
}

// ---------- voice notes ----------

const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** Length of a voice note in seconds (rounded up), from the file itself. */
export function audioDurationSec(b: Uint8Array, type: AudioType): number {
  if (type === 'audio/aac') {
    let at = adtsStart(b);
    need(at !== null, 'not ADTS audio');
    let samples = 0;
    let rate = 0;
    while (at + 7 <= b.length && b[at] === 0xff && (b[at + 1]! & 0xf6) === 0xf0) {
      rate = ADTS_RATES[(b[at + 2]! & 0x3c) >> 2] ?? 0;
      const len = ((b[at + 3]! & 0x03) << 11) | (b[at + 4]! << 3) | ((b[at + 5]! & 0xe0) >> 5);
      need(len >= 7, 'bad ADTS frame');
      samples += 1024;
      at += len;
    }
    need(rate > 0, 'unknown sample rate');
    return Math.ceil(samples / rate);
  }
  const moov = boxes(b, 0, b.length).find((x) => x.type === 'moov');
  need(!!moov, 'no moov box');
  const mvhd = child(b, moov, 'mvhd');
  need(!!mvhd, 'no mvhd box');
  const v = b[mvhd.body]!;
  const at = mvhd.body + 4 + (v === 1 ? 16 : 8);
  need(at + (v === 1 ? 12 : 8) <= mvhd.end, 'short mvhd');
  const timescale = u32(b, at);
  const duration = v === 1 ? u32(b, at + 4) * 2 ** 32 + u32(b, at + 8) : u32(b, at + 4);
  need(timescale > 0, 'no timescale');
  return Math.ceil(duration / timescale);
}

// ---------- location removal ----------

const TIFF_TYPE_SIZE: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const GPS_IFD_TAG = 0x8825;
const XMP_TAG = 0x02bc;

/**
 * Zeroes the GPS IFD (and any XMP packet) of the TIFF structure starting at `tiff` in `b`, in place, leaving an empty
 * GPS IFD so the pointer to it stays valid. Returns true when something was removed.
 */
export function zeroTiffLocation(b: Uint8Array, tiff: number, end: number): boolean {
  need(tiff + 8 <= end, 'short TIFF header');
  const order = ascii(b, tiff, 2);
  need(order === 'II' || order === 'MM', 'bad TIFF byte order');
  const le = order === 'II';
  const r16 = (at: number) => (le ? b[at]! | (b[at + 1]! << 8) : u16(b, at));
  const r32 = (at: number) => (le ? (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0 : u32(b, at));
  const w16 = (at: number, v: number) => (le ? ((b[at] = v & 0xff), (b[at + 1] = v >> 8)) : ((b[at] = v >> 8), (b[at + 1] = v & 0xff)));
  need(r16(tiff + 2) === 42, 'bad TIFF magic');
  const ifd0 = tiff + r32(tiff + 4);
  need(ifd0 + 2 <= end, 'IFD0 out of range');
  const entries = (ifd: number) => {
    const n = r16(ifd);
    need(ifd + 2 + n * 12 + 4 <= end, 'IFD out of range');
    return Array.from({ length: n }, (_, i) => {
      const at = ifd + 2 + i * 12;
      return { at, tag: r16(at), type: r16(at + 2), count: r32(at + 4), value: r32(at + 8) };
    });
  };
  const dataOf = (e: { at: number; type: number; count: number; value: number }) => {
    const size = (TIFF_TYPE_SIZE[e.type] ?? 1) * e.count;
    return size <= 4 ? { at: e.at + 8, size } : { at: tiff + e.value, size };
  };
  let removed = false;
  for (const e of entries(ifd0)) {
    if (e.tag === XMP_TAG) {
      const d = dataOf(e);
      need(d.at + d.size <= end, 'XMP out of range');
      b.fill(0x20, d.at, d.at + d.size); // spaces: still a valid (empty) packet slot
      removed = true;
    }
    if (e.tag !== GPS_IFD_TAG) continue;
    const gps = tiff + e.value;
    need(gps + 2 <= end, 'GPS IFD out of range');
    const gpsEntries = entries(gps);
    for (const g of gpsEntries) {
      const d = dataOf(g);
      if (d.at >= gps + 2 && d.at < gps + 2 + gpsEntries.length * 12) continue; // inline value, cleared below
      need(d.at + d.size <= end, 'GPS value out of range');
      b.fill(0, d.at, d.at + d.size);
    }
    b.fill(0, gps, gps + 2 + gpsEntries.length * 12 + 4); // no entries, no next IFD
    w16(gps, 0);
    removed = true;
  }
  return removed;
}

const XMP_JPEG = ['http://ns.adobe.com/xap/1.0/\0', 'http://ns.adobe.com/xmp/extension/\0'];

function stripJpeg(b: Uint8Array): Uint8Array {
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= b.length) {
    need(b[at] === 0xff, 'bad JPEG marker');
    const marker = b[at + 1]!;
    if (marker === 0xd9 || marker === 0xda) break; // end of image, or start of the compressed data: no metadata after
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      keep.push(b.subarray(at, at + 2));
      at += 2;
      continue;
    }
    const len = u16(b, at + 2);
    need(len >= 2 && at + 2 + len <= b.length, 'bad JPEG segment');
    const payload = at + 4;
    const end = at + 2 + len;
    if (marker === 0xe1 && ascii(b, payload, 6) === 'Exif\0\0') zeroTiffLocation(b, payload + 6, end);
    if (marker === 0xe1 && XMP_JPEG.some((sig) => ascii(b, payload, sig.length) === sig)) {
      at = end; // drop the XMP segment
      continue;
    }
    keep.push(b.subarray(at, end));
    at = end;
  }
  keep.push(b.subarray(at));
  return Buffer.concat(keep);
}

function stripPng(b: Uint8Array): Uint8Array {
  const keep: Uint8Array[] = [b.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= b.length) {
    const len = u32(b, at);
    const type = ascii(b, at + 4, 4);
    const end = at + 12 + len;
    need(end <= b.length, `bad PNG ${type} chunk`);
    const data = at + 8;
    const keyword = ascii(b, data, Math.min(len, 18));
    if ((type === 'iTXt' || type === 'tEXt' || type === 'zTXt') && keyword.startsWith('XML:com.adobe.xmp')) {
      at = end;
      continue;
    }
    if (type === 'eXIf' && zeroTiffLocation(b, data, data + len)) {
      const crc = crc32(b.subarray(at + 4, data + len));
      b[data + len] = crc >>> 24;
      b[data + len + 1] = (crc >>> 16) & 0xff;
      b[data + len + 2] = (crc >>> 8) & 0xff;
      b[data + len + 3] = crc & 0xff;
    }
    keep.push(b.subarray(at, end));
    at = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(keep);
}

/** HEIF items: where each item's bytes are (file offsets), with its type. */
function heifItems(b: Uint8Array): { id: number; type: string; contentType: string; extents: { at: number; size: number }[] }[] {
  const meta = boxes(b, 0, b.length).find((x) => x.type === 'meta');
  need(!!meta, 'no meta box');
  const inner = boxes(b, meta.body + 4, meta.end);
  const iinf = inner.find((x) => x.type === 'iinf');
  const iloc = inner.find((x) => x.type === 'iloc');
  const idat = inner.find((x) => x.type === 'idat');
  if (!iinf || !iloc) return [];
  const info = new Map<number, { type: string; contentType: string }>();
  const iinfV = b[iinf.body]!;
  for (const infe of boxes(b, iinf.body + 4 + (iinfV === 0 ? 2 : 4), iinf.end).filter((x) => x.type === 'infe')) {
    const v = b[infe.body]!;
    if (v < 2) continue;
    let at = infe.body + 4;
    const id = v === 2 ? u16(b, at) : u32(b, at);
    at += (v === 2 ? 2 : 4) + 2;
    const type = ascii(b, at, 4);
    at += 4;
    const nameEnd = b.indexOf(0, at);
    let contentType = '';
    if (type === 'mime' && nameEnd >= 0 && nameEnd < infe.end) {
      const ctEnd = b.indexOf(0, nameEnd + 1);
      contentType = ascii(b, nameEnd + 1, Math.max(0, (ctEnd < 0 || ctEnd > infe.end ? infe.end : ctEnd) - nameEnd - 1));
    }
    info.set(id, { type, contentType });
  }
  const v = b[iloc.body]!;
  let at = iloc.body + 4;
  const offsetSize = b[at]! >> 4;
  const lengthSize = b[at]! & 0x0f;
  const baseSize = b[at + 1]! >> 4;
  const indexSize = v === 1 || v === 2 ? b[at + 1]! & 0x0f : 0;
  at += 2;
  const readN = (n: number) => {
    let x = 0;
    for (let i = 0; i < n; i++) x = x * 256 + b[at + i]!;
    at += n;
    return x;
  };
  const count = v < 2 ? readN(2) : readN(4);
  const items = [];
  for (let i = 0; i < count; i++) {
    need(at < iloc.end, 'iloc out of range');
    const id = v < 2 ? readN(2) : readN(4);
    const method = v === 1 || v === 2 ? readN(2) & 0x0f : 0;
    readN(2); // data reference index
    const base = readN(baseSize);
    const extents = [];
    for (let e = readN(2); e > 0; e--) {
      if (indexSize > 0) readN(indexSize);
      const offset = readN(offsetSize);
      const size = readN(lengthSize);
      const origin = method === 1 ? (idat?.body ?? -1) : 0;
      need(origin >= 0 && method <= 1, 'unsupported item construction');
      extents.push({ at: origin + base + offset, size });
    }
    const it = info.get(id);
    if (it) items.push({ id, ...it, extents });
  }
  return items;
}

function stripHeic(b: Uint8Array): Uint8Array {
  for (const item of heifItems(b)) {
    for (const e of item.extents) need(e.at >= 0 && e.at + e.size <= b.length, 'item out of range');
    if (item.type === 'Exif') {
      const [e] = item.extents;
      if (item.extents.length === 1 && e && e.size >= 4) {
        zeroTiffLocation(b, e.at + 4 + u32(b, e.at), e.at + e.size);
      } else {
        for (const x of item.extents) b.fill(0, x.at, x.at + x.size); // unusual layout: drop all EXIF
      }
    }
    if (item.type === 'mime' && item.contentType === 'application/rdf+xml') {
      for (const x of item.extents) b.fill(0x20, x.at, x.at + x.size); // XMP
    }
  }
  return b;
}

/** The photo without location data. Throws MediaError when the file cannot be read safely (it is then refused). */
export function stripLocation(input: Uint8Array, type: PhotoType): Uint8Array {
  const b = new Uint8Array(input); // never modify the caller's buffer
  if (type === 'image/jpeg') return stripJpeg(b);
  if (type === 'image/png') return stripPng(b);
  return stripHeic(b);
}
