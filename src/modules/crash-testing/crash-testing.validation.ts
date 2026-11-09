import { z } from 'zod';

/** Quy tắc validate cho module crash-testing. */

export const registerDeviceSchema = z.object({
  deviceId: z.string().trim().min(8).max(100),
  deviceName: z.string().trim().max(120).optional(),
  platform: z.string().trim().max(50).optional(),
  appVersion: z.string().trim().max(50).optional(),
  userId: z.string().trim().max(100).optional(),
});

export type RegisterDeviceDto = z.infer<typeof registerDeviceSchema>;

export const heartbeatSchema = z.object({
  deviceId: z.string().trim().min(8).max(100),
  isOnline: z.boolean().default(true),
});

export type HeartbeatDto = z.infer<typeof heartbeatSchema>;

export const createCrashRequestSchema = z.object({
  deviceId: z.string().trim().max(100).optional(),
  reason: z.string().trim().max(500).optional(),
});

export type CreateCrashRequestDto = z.infer<typeof createCrashRequestSchema>;

export const reportCrashRequestSchema = z.object({
  status: z.enum(['triggered', 'reported', 'failed']),
  result: z.string().trim().max(2000).optional(),
});

export type ReportCrashRequestDto = z.infer<typeof reportCrashRequestSchema>;
