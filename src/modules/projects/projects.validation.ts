import { z } from 'zod';

/** Quy tắc validate cho module projects. */

export const projectQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});

export type ProjectQueryDto = z.infer<typeof projectQuerySchema>;
