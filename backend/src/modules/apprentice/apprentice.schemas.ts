import { z } from 'zod';
import { CATEGORY_ORDER } from '../technicians/technicians.schemas';

export const MentorsQuery = z.object({ categoryId: z.enum(CATEGORY_ORDER) }).strict();
export const RequestBody = z.object({ mentorId: z.uuid(), categoryId: z.enum(CATEGORY_ORDER) }).strict();
export const AnswerBody = z.object({ accept: z.boolean() }).strict();
export const MentoringBody = z.object({ open: z.boolean() }).strict();
export const AddTraineeBody = z.object({ apprenticeId: z.uuid() }).strict();
export const ConfirmTraineeBody = z.object({ helped: z.boolean() }).strict();
