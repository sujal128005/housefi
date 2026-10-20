import { z } from 'zod';
import { AUDIO_TYPES, PHOTO_TYPES } from './media';

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
