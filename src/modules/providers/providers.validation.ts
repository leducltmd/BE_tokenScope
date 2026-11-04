import { z } from 'zod';

/** Quy tắc validate cho module providers. */

export const providerTypeSchema = z
  .string()
  .trim()
  .min(1, 'Loại nhà cung cấp là bắt buộc.')
  .max(50, 'Loại nhà cung cấp quá dài.');

export const apiKeySchema = z
  .string()
  .trim()
  .min(8, 'API Key quá ngắn.')
  .max(500, 'API Key quá dài.');

/** Body kiểm tra kết nối — không lưu khoá. */
export const testConnectionSchema = z.object({
  providerType: providerTypeSchema,
  apiKey: apiKeySchema,
  /**
   * Admin API Key của tổ chức (OpenAI / Anthropic) — dùng để đọc Usage & Costs.
   * Tuỳ chọn: nếu bỏ trống thì dùng khoá của máy chủ (chế độ demo).
   */
  adminApiKey: z
    .string()
    .trim()
    .min(8, 'Admin API Key quá ngắn.')
    .max(500, 'Admin API Key quá dài.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * Workspace ID của Anthropic (`wsp_...`) — tuỳ chọn.
   * Dùng làm header `anthropic-workspace-id` khi Secret API Key chưa được
   * scope vào Workspace nào.
   */
  workspaceId: z
    .string()
    .trim()
    .max(200, 'Workspace ID quá dài.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

/** Body tạo kết nối mới — khoá được mã hoá rồi lưu. */
export const createProviderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Tên kết nối phải có ít nhất 2 ký tự.')
    .max(120, 'Tên kết nối quá dài.'),
  providerType: providerTypeSchema,
  apiKey: apiKeySchema,
  /**
   * Admin API Key của tổ chức (OpenAI / Anthropic) — mã hoá rồi lưu cùng
   * kết nối.
   */
  adminApiKey: z
    .string()
    .trim()
    .min(8, 'Admin API Key quá ngắn.')
    .max(500, 'Admin API Key quá dài.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * Workspace ID của Anthropic (`wsp_...`) — mã hoá rồi lưu cùng kết nối.
   */
  workspaceId: z
    .string()
    .trim()
    .max(200, 'Workspace ID quá dài.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  projectId: z.string().trim().max(100).optional(),
});

/**
 * Body cập nhật khoá của một kết nối đã lưu.
 *
 * Mỗi loại khoá được cập nhật **độc lập** — chỉ trường được gửi lên mới
 * thay đổi, các trường khác giữ nguyên giá trị đã lưu.
 */
export const updateProviderKeysSchema = z
  .object({
    /** Secret API Key mới (bỏ trống = giữ nguyên). */
    apiKey: apiKeySchema.optional(),
    /** Admin API Key mới (bỏ trống = giữ nguyên). */
    adminApiKey: z
      .string()
      .trim()
      .min(8, 'Admin API Key quá ngắn.')
      .max(500, 'Admin API Key quá dài.')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    /** Workspace ID mới (bỏ trống = giữ nguyên). */
    workspaceId: z
      .string()
      .trim()
      .max(200, 'Workspace ID quá dài.')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    /** Xoá Admin API Key đã lưu (OpenAI / Anthropic). */
    clearAdminApiKey: z.boolean().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.apiKey) ||
      Boolean(value.adminApiKey) ||
      Boolean(value.workspaceId) ||
      value.clearAdminApiKey === true,
    {
      message: 'Cần ít nhất một khoá hoặc Workspace ID để cập nhật.',
    },
  );

/** Body đổi tên kết nối. */
export const updateProviderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Tên kết nối phải có ít nhất 2 ký tự.')
    .max(120, 'Tên kết nối quá dài.'),
});

// ── OpenAI Organization (Usage & Costs) ─────────────────────────────────

/** Bucket width hợp lệ cho Usage API. */
const bucketWidthSchema = z.enum(['1m', '1h', '1d']);

/** Trường gom nhóm cho Usage API. */
const usageGroupBySchema = z.enum([
  'project_id',
  'user_id',
  'api_key_id',
  'model',
  'batch',
  'service_tier',
  'api_source',
]);

/** Trường gom nhóm cho Costs API. */
const costGroupBySchema = z.enum([
  'project_id',
  'user_id',
  'line_item',
  'api_key_id',
  'api_source',
]);

/**
 * Chuẩn hoá danh sách query param lặp lại (`?group_by=model&group_by=project_id`).
 *
 * Express gom các query param lặp lại thành mảng; giá trị rỗng bị loại bỏ.
 */
function toArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value : [value];
  const items = raw
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** Query đọc Usage của tổ chức OpenAI. */
export const openaiUsageQuerySchema = z.object({
  /** Khoảng thời gian — số ngày gần nhất (mặc định 30). */
  days: z.coerce.number().int().min(1).max(90).default(30),
  /** Mốc bắt đầu (Unix giây) — dùng thay cho `days` nếu có. */
  start_time: z.coerce.number().int().positive().optional(),
  /** Mốc kết thúc (Unix giây). */
  end_time: z.coerce.number().int().positive().optional(),
  bucket_width: bucketWidthSchema.default('1d'),
  project_ids: z.string().trim().max(2000).optional(),
  models: z.string().trim().max(2000).optional(),
  group_by: z.string().trim().max(500).optional(),
  /** Số bucket mỗi trang (OpenAI: tối đa 31 với `1d`, 168 với `1h`, 1440 với `1m`). */
  limit: z.coerce.number().int().min(1).max(1440).optional(),
  /** Con trỏ trang. */
  page: z.string().trim().max(500).optional(),
});

/** Query đọc Costs của tổ chức OpenAI. */
export const openaiCostQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  start_time: z.coerce.number().int().positive().optional(),
  end_time: z.coerce.number().int().positive().optional(),
  /** Costs API hiện chỉ hỗ trợ bucket theo ngày. */
  bucket_width: z.literal('1d').default('1d'),
  project_ids: z.string().trim().max(2000).optional(),
  line_items: z.string().trim().max(2000).optional(),
  group_by: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(180).optional(),
  page: z.string().trim().max(500).optional(),
});

export type TestConnectionDto = z.infer<typeof testConnectionSchema>;
export type CreateProviderDto = z.infer<typeof createProviderSchema>;
export type UpdateProviderDto = z.infer<typeof updateProviderSchema>;
export type UpdateProviderKeysDto = z.infer<typeof updateProviderKeysSchema>;
export type OpenAIUsageQueryDto = z.infer<typeof openaiUsageQuerySchema>;
export type OpenAICostQueryDto = z.infer<typeof openaiCostQuerySchema>;

export { toArray };
