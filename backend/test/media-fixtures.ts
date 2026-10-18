// Real (tiny) media files built byte by byte, with the metadata the uploads checks care about: GPS coordinates,
// an orientation that must survive, XMP that may repeat the location, and audio of a known length.
import { crc32 } from 'node:zlib';

const be16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
const be32 = (n: number) => Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const le16 = (n: number) => Buffer.from([n & 0xff, n >> 8]);
const le32 = (n: number) => Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([be32(8 + body.length), Buffer.from(type, 'ascii'), body]);
};
const fullBox = (type: string, version: number, ...parts: Buffer[]) => box(type, Buffer.from([version, 0, 0, 0]), ...parts);

/** Latitude 17°24'45" as TIFF rationals: what must disappear. */
export const GPS_LATITUDE = Buffer.concat([le32(17), le32(1), le32(24), le32(1), le32(45), le32(1)]);
export const ORIENTATION_ROTATE_90 = 6;
export const XMP_PACKET = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><exif:GPSLatitude>17,24.75N</exif:GPSLatitude></x:xmpmeta>';

/**
 * A little-endian TIFF block: IFD0 with Orientation and a pointer to a GPS IFD holding a latitude reference (inline)
 * and the latitude (three rationals stored after the IFD).
 */
export function tiffWithGps(): Buffer {
  const ifd0At = 8;
  const ifd0Size = 2 + 2 * 12 + 4;
  const gpsAt = ifd0At + ifd0Size;
  const gpsSize = 2 + 2 * 12 + 4;
  const latAt = gpsAt + gpsSize;
  const entry = (tag: number, type: number, count: number, value: Buffer) => Buffer.concat([le16(tag), le16(type), le32(count), value]);
  return Buffer.concat([
    Buffer.from('II'), le16(42), le32(ifd0At),
    le16(2), entry(0x0112, 3, 1, Buffer.concat([le16(ORIENTATION_ROTATE_90), le16(0)])), entry(0x8825, 4, 1, le32(gpsAt)), le32(0),
    le16(2), entry(0x0001, 2, 2, Buffer.from('N\0\0\0', 'binary')), entry(0x0002, 5, 3, le32(latAt)), le32(0),
    GPS_LATITUDE,
  ]);
}

/** Reads what the checks promise to keep or remove from a TIFF block. */
export function readTiff(b: Uint8Array, at: number) {
  const r16 = (o: number) => b[at + o]! | (b[at + o + 1]! << 8);
  const r32 = (o: number) => (b[at + o]! | (b[at + o + 1]! << 8) | (b[at + o + 2]! << 16) | (b[at + o + 3]! << 24)) >>> 0;
  const ifd0 = r32(4);
  const entries = Array.from({ length: r16(ifd0) }, (_, i) => ({ tag: r16(ifd0 + 2 + i * 12), value: r32(ifd0 + 2 + i * 12 + 8) }));
  const gps = entries.find((e) => e.tag === 0x8825)?.value;
  return { orientation: entries.find((e) => e.tag === 0x0112)?.value, gpsEntries: gps !== undefined ? r16(gps) : null };
}

export const hasBytes = (b: Uint8Array, needle: Uint8Array | string) => Buffer.from(b).includes(Buffer.from(needle));

export function jpegWithGps(): Buffer {
  const tiff = tiffWithGps();
  const segment = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), be16(payload.length + 2), payload]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])),
    segment(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'binary'), Buffer.from(XMP_PACKET)])),
    segment(0xdb, Buffer.alloc(65, 1)), // a quantisation table
    Buffer.from([0xff, 0xda]), be16(8), Buffer.from([1, 1, 0, 0, 63, 0]), // start of scan
    Buffer.from([0x12, 0x34, 0x56, 0x78]), // "image data"
    Buffer.from([0xff, 0xd9]),
  ]);
}

const pngChunk = (type: string, data: Buffer) => {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([be32(data.length), typeAndData, be32(crc32(typeAndData))]);
};

export function pngWithGps(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.concat([be32(1), be32(1), Buffer.from([8, 2, 0, 0, 0])])),
    pngChunk('eXIf', tiffWithGps()),
    pngChunk('iTXt', Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\0\0\0\0', 'binary'), Buffer.from(XMP_PACKET)])),
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Every PNG chunk with whether its CRC is right. */
export function pngChunks(b: Uint8Array): { type: string; crcOk: boolean; data: Uint8Array }[] {
  const out = [];
  let at = 8;
  while (at + 12 <= b.length) {
    const len = (b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!;
    const type = Buffer.from(b.subarray(at + 4, at + 8)).toString('ascii');
    const stored = ((b[at + 8 + len]! << 24) | (b[at + 9 + len]! << 16) | (b[at + 10 + len]! << 8) | b[at + 11 + len]!) >>> 0;
    out.push({ type, crcOk: crc32(b.subarray(at + 4, at + 8 + len)) === stored, data: b.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  return out;
}

/** A HEIF still image with an Exif item and an XMP ("mime", application/rdf+xml) item, both in mdat. */
export function heicWithGps(): { file: Buffer; exifAt: number } {
  const exif = Buffer.concat([be32(0), tiffWithGps()]); // HEIF Exif item: offset to the TIFF header, then TIFF
  const xmp = Buffer.from(XMP_PACKET);
  const ftyp = box('ftyp', Buffer.from('heic'), be32(0), Buffer.from('mif1heic'));
  const infe = (id: number, type: string, extra: Buffer) => fullBox('infe', 2, be16(id), be16(0), Buffer.from(type, 'ascii'), Buffer.from('\0'), extra);
  const iinf = fullBox('iinf', 0, be16(2), infe(1, 'Exif', Buffer.alloc(0)), infe(2, 'mime', Buffer.from('application/rdf+xml\0')));
  const meta = (exifOffset: number, xmpOffset: number) =>
    fullBox(
      'meta', 0,
      fullBox('hdlr', 0, be32(0), Buffer.from('pict'), Buffer.alloc(12), Buffer.from('\0')),
      iinf,
      // version 0; offset size 4, length size 4, base offset size 0; two items with one extent each
      fullBox('iloc', 0, Buffer.from([0x44, 0x00]), be16(2),
        be16(1), be16(0), be16(1), be32(exifOffset), be32(exif.length),
        be16(2), be16(0), be16(1), be32(xmpOffset), be32(xmp.length)),
    );
  const head = ftyp.length + meta(0, 0).length;
  const mdatBody = head + 8;
  const file = Buffer.concat([ftyp, meta(mdatBody, mdatBody + exif.length), box('mdat', exif, xmp)]);
  return { file, exifAt: mdatBody + 4 };
}

/** An M4A (MPEG-4 audio) file whose movie header says `seconds` long. */
export function m4a(seconds: number): Buffer {
  const mvhd = fullBox('mvhd', 0, be32(0), be32(0), be32(1000), be32(Math.round(seconds * 1000)), Buffer.alloc(80));
  return Buffer.concat([box('ftyp', Buffer.from('M4A '), be32(0), Buffer.from('M4A mp42isom')), box('moov', mvhd), box('mdat', Buffer.alloc(16))]);
}

/** Raw AAC (ADTS) at 44.1 kHz: `frames` frames of 1024 samples each. */
export function adts(frames: number): Buffer {
  const frame = Buffer.from([0xff, 0xf1, (1 << 6) | (4 << 2), 0x80, 0x00 | (7 >> 3), ((7 & 7) << 5) | 0x1f, 0xfc]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}
