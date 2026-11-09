import { z } from 'zod';

/** Quy tắc validate cho module admin. */

export const adminRangeSchema = z.object({
  range: z.enum(['day', 'week', 'month']).default('week'),
});

export type AdminRangeDto = z.infer<typeof adminRangeSchema>;

export const adminUsersQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminUsersQueryDto = z.infer<typeof adminUsersQuerySchema>;

export const adminUserDetailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type AdminUserDetailQueryDto = z.infer<typeof adminUserDetailQuerySchema>;
