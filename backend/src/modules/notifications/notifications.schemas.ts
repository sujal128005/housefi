import { z } from 'zod';

export const MarkReadBody = z.object({ ids: z.array(z.string().max(64)).max(200) }).strict();

export const DeviceBody = z
  .object({
    pushToken: z.string().trim().min(1).max(512),
    platform: z.enum(['ios', 'android', 'web']),
  })
  .strict();
