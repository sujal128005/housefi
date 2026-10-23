// Photos, voice notes, work videos and certificates go straight from the phone to Housefi's private storage: the API hands out a short-lived
// upload URL for one file of a declared type and size, the phone PUTs the file there, and the file's id is sent with
// the booking (or the AI call). The server checks every file before using it. One upload per local file: retries and
// the same photo used twice (photo check, then the booking) reuse the first upload.
import { ApiError } from '../api';

export type UploadKind = 'photos' | 'audio' | 'videos' | 'documents';
export type PhotoStage = 'PROBLEM' | 'INSPECTION' | 'COMPLETION' | 'PROFILE' | 'CHAT';

export interface UploadTicket {
  readonly id: string;
  readonly uploadUrl: string;
}

const PHOTO_TYPES: Readonly<Record<string, string>> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic' };
const AUDIO_TYPES: Readonly<Record<string, string>> = { m4a: 'audio/m4a', mp4: 'audio/mp4', aac: 'audio/aac' };
const VIDEO_TYPES: Readonly<Record<string, string>> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime' };
const DOCUMENT_TYPES: Readonly<Record<string, string>> = { pdf: 'application/pdf', ...PHOTO_TYPES };
const ALLOWED: Readonly<Record<UploadKind, Readonly<Record<string, string>>>> = { photos: PHOTO_TYPES, audio: AUDIO_TYPES, videos: VIDEO_TYPES, documents: DOCUMENT_TYPES };

/** The file's type: what the file says, else its extension. Only the types the API accepts. */
export function contentTypeFor(kind: UploadKind, uri: string, blobType: string): string {
  const allowed = ALLOWED[kind];
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(uri)?.[1]?.toLowerCase() ?? '';
  // A certificate's ".pdf" wins: phones may report a local file's type as anything.
  if (kind === 'documents' && ext === 'pdf') return 'application/pdf';
  const declared = blobType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (Object.values(allowed).includes(declared)) return declared;
  if (kind === 'audio' && (declared === 'audio/x-m4a' || declared === 'audio/mpeg4')) return 'audio/m4a';
  const byExt = allowed[ext];
  if (byExt) return byExt;
  throw new ApiError('VALIDATION', { message: 'unsupported file type' });
}

export function createUploader(deps: {
  readonly fetch: typeof fetch;
  /** POST /uploads/{kind} with the caller's token. */
  readonly ticket: (handle: string, kind: UploadKind, body: { contentType: string; bytes: number; stage?: PhotoStage }) => Promise<UploadTicket>;
}) {
  // Per signed-in account and local file: the upload id.
  const done = new Map<string, string>();
  const running = new Map<string, Promise<string>>();

  async function put(handle: string, kind: UploadKind, uri: string, stage?: PhotoStage): Promise<string> {
    // The file's bytes, not a Blob: Expo's fetch builds React Native Blobs through a native call that Expo Go may not
    // have, while plain bytes read and upload the same way everywhere (files are at most a few MB).
    let bytes: ArrayBuffer;
    let declared: string;
    try {
      const file = await deps.fetch(uri);
      declared = file.headers?.get('content-type') ?? '';
      bytes = await file.arrayBuffer();
    } catch {
      throw new ApiError('VALIDATION', { message: 'the file could not be read' });
    }
    if (bytes.byteLength === 0) throw new ApiError('VALIDATION', { message: 'the file is empty' });
    const contentType = contentTypeFor(kind, uri, declared);
    const t = await deps.ticket(handle, kind, { contentType, bytes: bytes.byteLength, ...(stage ? { stage } : {}) });
    let res: Response;
    try {
      res = await deps.fetch(t.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
    } catch {
      throw new ApiError('NETWORK');
    }
    if (!res.ok) throw new ApiError(res.status >= 500 ? 'SERVER_ERROR' : 'VALIDATION', { message: `upload HTTP ${res.status}` });
    return t.id;
  }

  return {
    /** The upload id for a local file, uploading it the first time. */
    upload(handle: string, kind: UploadKind, uri: string, stage?: PhotoStage): Promise<string> {
      const key = `${handle}|${kind}|${stage ?? ''}|${uri}`;
      const known = done.get(key);
      if (known) return Promise.resolve(known);
      const inflight = running.get(key);
      if (inflight) return inflight;
      const p = put(handle, kind, uri, stage)
        .then((id) => {
          done.set(key, id);
          return id;
        })
        .finally(() => running.delete(key));
      running.set(key, p);
      return p;
    },
    /** Signing out forgets which files this account uploaded. */
    forget(handle: string): void {
      for (const k of [...done.keys()]) if (k.startsWith(`${handle}|`)) done.delete(k);
    },
  };
}

/** Local files only: a URL the server gave us (an already uploaded photo) is never uploaded again. */
export function isLocalFile(uri: string | undefined): uri is string {
  return !!uri && /^(file|content|ph|assets-library|blob|data):/i.test(uri);
}
