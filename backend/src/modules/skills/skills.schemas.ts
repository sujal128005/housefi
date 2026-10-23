import { z } from 'zod';
import { CATEGORY_ORDER } from '../technicians/technicians.schemas';

export const SKILL_LEVELS = ['UNSKILLED', 'SEMI_SKILLED', 'SKILLED', 'HIGHLY_SKILLED'] as const;
const UUID = z.string().uuid();

/** openapi.yaml SkillLevelInput. */
export const SkillLevelBody = z.object({ level: z.enum(SKILL_LEVELS) }).strict();

/** openapi.yaml SkillExamStart. */
export const ExamStartBody = z.object({ categoryId: z.enum(CATEGORY_ORDER) }).strict();

/** A section number in the path (0, 1 or 2). */
export const SectionIndex = z.coerce.number().int().min(0).max(2);

/** openapi.yaml SkillExamAnswer: an option id as the paper gave it ("a"...). */
export const ExamAnswerBody = z.object({ optionId: z.string().regex(/^[a-f]$/) }).strict();

/**
 * openapi.yaml SkillVideoInput: a checked upload (POST /uploads/videos), recorded in the app (LIVE) or chosen from the
 * gallery (UPLOAD). SAMPLE (no file) is for the team's demo accounts only.
 */
export const SkillVideoBody = z
  .object({ source: z.enum(['LIVE', 'UPLOAD', 'SAMPLE']), uploadId: UUID.optional() })
  .strict()
  .refine((b) => (b.source === 'SAMPLE') === (b.uploadId === undefined), { message: 'a file for LIVE / UPLOAD, none for SAMPLE', path: ['uploadId'] });

/** openapi.yaml SkillCertificateInput: a checked upload (POST /uploads/documents); `sample` (no file) for demo accounts only. */
export const SkillCertificateBody = z
  .object({
    kind: z.enum(['ITI', 'SKILL_INDIA', 'OTHER']),
    title: z.string().trim().max(80).default(''),
    uploadId: UUID.optional(),
    sample: z.boolean().default(false),
  })
  .strict()
  .refine((b) => b.sample === (b.uploadId === undefined), { message: 'a file, or sample for a demo account', path: ['uploadId'] });

export type SkillVideoInput = z.infer<typeof SkillVideoBody>;
export type SkillCertificateInput = z.infer<typeof SkillCertificateBody>;

// ---------- HQ ----------

export const VideoDecisionBody = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    /** The trades the video shows (APPROVE: at least one, from the technician's own trades). */
    categoryIds: z.array(z.enum(CATEGORY_ORDER)).max(6).default([]),
    note: z.string().trim().max(300).default(''),
  })
  .strict()
  .refine((b) => b.decision === 'REJECT' || b.categoryIds.length > 0, { message: 'choose the trades the video shows', path: ['categoryIds'] })
  .refine((b) => b.decision === 'APPROVE' || b.note.length >= 3, { message: 'say why, the technician sees it', path: ['note'] });

export const CertificateDecisionBody = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(300).default('') })
  .strict()
  .refine((b) => b.decision === 'APPROVE' || b.note.length >= 3, { message: 'say why, the technician sees it', path: ['note'] });

/** HQ verifies (or withdraws) one trade itself, e.g. a keypad-phone technician tested in person. */
export const TradeDecisionBody = z
  .object({ categoryId: z.enum(CATEGORY_ORDER), verified: z.boolean(), note: z.string().trim().min(3).max(300) })
  .strict();

export const SkillQueueQuery = z.object({ state: z.enum(['WAITING', 'ALL']).default('WAITING') });
