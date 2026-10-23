import { z } from 'zod';
import { AUDIO_TYPES, DOCUMENT_TYPES, PHOTO_TYPES, VIDEO_TYPES } from './media';

/** openapi.yaml /uploads/photos: jpeg / png / heic, at most 8 MB; the exact size (S3 refuses any other). */
export const PhotoTicketBody = z
  .object({
    contentType: z.enum(PHOTO_TYPES),
    bytes: z.number().int().min(1).max(8 * 1024 * 1024),
    stage: z.enum(['PROBLEM', 'INSPECTION', 'COMPLETION', 'PROFILE', 'CHAT']).optional(),
  })
  .strict();

/** openapi.yaml /uploads/audio: m4a / mp4 / aac, at most 2 MB (and 60 s, checked from the file). */
export const AudioTicketBody = z
  .object({ contentType: z.enum(AUDIO_TYPES), bytes: z.number().int().min(1).max(2 * 1024 * 1024) })
  .strict();

/** openapi.yaml /uploads/videos: a technician's work video for the skill check, mp4 / mov, at most 100 MB (and 2 min). */
export const VideoTicketBody = z
  .object({ contentType: z.enum(VIDEO_TYPES), bytes: z.number().int().min(1).max(100 * 1024 * 1024) })
  .strict();

/** openapi.yaml /uploads/documents: a certificate, PDF or photo, at most 10 MB. */
export const DocumentTicketBody = z
  .object({ contentType: z.enum(DOCUMENT_TYPES), bytes: z.number().int().min(1).max(10 * 1024 * 1024) })
  .strict();
