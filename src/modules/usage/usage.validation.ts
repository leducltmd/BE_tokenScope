import { z } from 'zod';

/** Quy tắc validate cho module usage. */

export const usageQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  providerId: z.string().trim().max(100).optional(),
  providerType: z.string().trim().max(50).optional(),
  from: z.string().trim().max(30).optional(),
  to: z.string().trim().max(30).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type UsageQueryDto = z.infer<typeof usageQuerySchema>;
