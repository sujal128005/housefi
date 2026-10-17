import { adts, GPS_LATITUDE, hasBytes, heicWithGps, jpegWithGps, m4a, ORIENTATION_ROTATE_90, pngChunks, pngWithGps, readTiff, XMP_PACKET } from '../../../test/media-fixtures';
import { audioDurationSec, isType, MediaError, stripLocation } from './media';

describe('file type checks (from the bytes, not the label)', () => {
  it('recognises each allowed type, and nothing else', () => {
    const files = { jpeg: jpegWithGps(), png: pngWithGps(), heic: heicWithGps().file, m4a: m4a(5), aac: adts(10) };
    expect(isType(files.jpeg, 'image/jpeg')).toBe(true);
    expect(isType(files.png, 'image/png')).toBe(true);
    expect(isType(files.heic, 'image/heic')).toBe(true);
    expect(isType(files.m4a, 'audio/m4a')).toBe(true);
    expect(isType(files.m4a, 'audio/mp4')).toBe(true);
    expect(isType(files.aac, 'audio/aac')).toBe(true);

    expect(isType(files.png, 'image/jpeg')).toBe(false);
    expect(isType(files.jpeg, 'image/png')).toBe(false);
    expect(isType(files.m4a, 'image/heic')).toBe(false); // an audio file is not a photo
    expect(isType(files.heic, 'audio/m4a')).toBe(false); // nor the other way round
    expect(isType(Buffer.from('<html>not a photo</html>'), 'image/jpeg')).toBe(false);
    expect(isType(Buffer.alloc(0), 'audio/aac')).toBe(false);
  });
});

describe('voice note length', () => {
  it('reads MPEG-4 audio from the movie header, rounded up', () => {
    expect(audioDurationSec(m4a(12.3), 'audio/m4a')).toBe(13);
    expect(audioDurationSec(m4a(60), 'audio/mp4')).toBe(60);
  });

  it('counts ADTS frames for raw AAC', () => {
    expect(audioDurationSec(adts(430), 'audio/aac')).toBe(10); // 430 x 1024 / 44100 = 9.98 s
    expect(audioDurationSec(adts(2600), 'audio/aac')).toBe(61);
  });

  it('refuses a file it cannot measure', () => {
    expect(() => audioDurationSec(Buffer.concat([m4a(5).subarray(0, 24)]), 'audio/m4a')).toThrow(MediaError);
  });
});

describe('location removal', () => {
  it('JPEG: zeroes the GPS data, keeps the orientation and the image, drops XMP', () => {
    const original = jpegWithGps();
    const clean = stripLocation(original, 'image/jpeg');
    expect(hasBytes(clean, GPS_LATITUDE)).toBe(false);
    expect(hasBytes(clean, XMP_PACKET)).toBe(false);
    const tiffAt = Buffer.from(clean).indexOf('Exif\0\0', 0, 'binary') + 6;
    expect(readTiff(clean, tiffAt)).toEqual({ orientation: ORIENTATION_ROTATE_90, gpsEntries: 0 });
    expect(hasBytes(clean, Buffer.from([0x12, 0x34, 0x56, 0x78, 0xff, 0xd9]))).toBe(true);
    expect(isType(clean, 'image/jpeg')).toBe(true);
    expect(hasBytes(original, GPS_LATITUDE)).toBe(true); // the caller's buffer is untouched
  });

  it('PNG: zeroes the GPS data in eXIf with a correct CRC, drops the XMP chunk', () => {
    const clean = stripLocation(pngWithGps(), 'image/png');
    const chunks = pngChunks(clean);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND']);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    expect(readTiff(chunks[1]!.data, 0)).toEqual({ orientation: ORIENTATION_ROTATE_90, gpsEntries: 0 });
    expect(hasBytes(clean, GPS_LATITUDE)).toBe(false);
  });

  it('HEIC: zeroes the GPS data in the Exif item and blanks the XMP item, in place (same size)', () => {
    const { file, exifAt } = heicWithGps();
    const clean = stripLocation(file, 'image/heic');
    expect(clean.length).toBe(file.length);
    expect(readTiff(clean, exifAt)).toEqual({ orientation: ORIENTATION_ROTATE_90, gpsEntries: 0 });
    expect(hasBytes(clean, GPS_LATITUDE)).toBe(false);
    expect(hasBytes(clean, 'GPSLatitude')).toBe(false);
    expect(isType(clean, 'image/heic')).toBe(true);
  });

  it('leaves a photo without location as it is', () => {
    const plain = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xda, 0, 4, 1, 2]), Buffer.from([0xff, 0xd9])]);
    expect(Buffer.compare(stripLocation(plain, 'image/jpeg'), plain)).toBe(0);
  });

  it('refuses files it cannot read safely', () => {
    const broken = Buffer.from(jpegWithGps());
    broken.writeUInt16BE(0xfff0, 4); // first segment claims to run past the end of the file
    expect(() => stripLocation(broken, 'image/jpeg')).toThrow(MediaError);
    const badTiff = Buffer.from(pngWithGps());
    const at = badTiff.indexOf('eXIf') + 4;
    badTiff.write('XX', at); // not a TIFF byte order
    expect(() => stripLocation(badTiff, 'image/png')).toThrow(MediaError);
  });
});
