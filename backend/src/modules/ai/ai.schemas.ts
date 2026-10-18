import { z } from 'zod';

const Locale = z.enum(['en', 'te']);
/** Upload ids from POST /uploads/photos and /uploads/audio (checked against the caller's uploads). */
const UploadId = z.string().trim().min(1).max(100);

export const TopProblemsQuery = z.object({ pincode: z.string().regex(/^[1-9][0-9]{5}$/).optional() }).strict();

export const ClassifyPhotoBody = z.object({ photoId: UploadId }).strict();

export const TranscribeBody = z.object({ audioId: UploadId, serviceId: z.string().max(64).nullable().optional(), locale: Locale }).strict();

export const ChatBody = z
  .object({
    message: z.string().trim().min(1).max(1000),
    locale: Locale,
    conversationId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
