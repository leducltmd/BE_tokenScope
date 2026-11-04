import {
  getOrgAllowedUserIds,
  isOrgAccessEnabled,
} from '../../config';
import { AppError, ForbiddenError } from '../../utils/errors';
import {
  fetchOpenAICosts,
  fetchOpenAIUsage,
  fetchOpenAIModels,
} from './providers.client';
import type {
  OpenAICostQuery,
  OpenAIUsageQuery,
} from './openai.service';

/**
 * Tầng service cho dữ liệu OpenAI ở cấp tổ chức (Usage & Costs).
 *
 * Quy tắc bảo mật:
 * - Admin API Key chỉ nằm trong biến môi trường của backend, không lưu DB,
 *   không trả về client, không ghi log.
 * - Endpoint thống kê yêu cầu đăng nhập (`requireAuth`) và được kiểm tra
 *   quyền đọc dữ liệu tổ chức qua [assertOrgAccess].
 * - Người dùng không thể truyền URL tuỳ ý — chỉ endpoint dưới đây được gọi.
 */

/** Thông điệp khi Admin API Key chưa được cấu hình. */
const ADMIN_KEY_MISSING_MESSAGE =
  'Chưa cấu hình OPENAI_ADMIN_API_KEY trên máy chủ. ' +
  'Hãy thêm Admin API Key của tổ chức OpenAI vào file .env rồi khởi động lại backend.';

/**
 * Kiểm tra người dùng có được phép đọc dữ liệu Organization hay không.
 *
 * Dữ liệu Usage/Costs là của toàn tổ chức nên có thể chứa hoạt động của các
 * thành viên khác. Vì vậy:
 * - `OPENAI_ORG_ACCESS_ENABLED` phải được bật (mặc định tắt).
 * - Nếu `OPENAI_ORG_ALLOWED_USER_IDS` có giá trị thì chỉ các user đó được đọc.
 */
export function assertOrgAccess(userId: string): void {
  if (!isOrgAccessEnabled()) {
    throw new ForbiddenError(
      'Tính năng đọc dữ liệu Usage/Costs cấp tổ chức đang tắt. ' +
        'Bật OPENAI_ORG_ACCESS_ENABLED=true trên máy chủ để sử dụng.',
    );
  }

  const allowed = getOrgAllowedUserIds();
  if (allowed.length > 0 && !allowed.includes(userId)) {
    throw new ForbiddenError(
      'Bạn không có quyền xem dữ liệu Usage/Costs của tổ chức.',
    );
  }
}

/**
 * Chuẩn hoá lỗi của OpenAI thành lỗi nghiệp vụ có mã HTTP tương ứng.
 *
 * - `401` → 401 `OPENAI_UNAUTHORIZED`
 * - `403` → 403 `OPENAI_FORBIDDEN`
 * - `404` → 404 `OPENAI_NOT_FOUND`
 * - `429` → 429 `OPENAI_RATE_LIMITED`
 * - lỗi mạng / timeout → 502 `OPENAI_UNREACHABLE`
 */
function toAppError(error: {
  kind: string;
  message: string;
  httpStatus?: number;
  detail?: string;
  retryAfter?: number;
}): AppError {
  switch (error.kind) {
    case 'notConfigured':
      // Lỗi cấu hình máy chủ — không phải lỗi của người dùng.
      return new AppError(503, error.message, 'OPENAI_NOT_CONFIGURED');
    case 'unauthorized':
      return new AppError(401, error.message, 'OPENAI_UNAUTHORIZED');
    case 'forbidden':
      return new AppError(403, error.message, 'OPENAI_FORBIDDEN');
    case 'notFound':
      return new AppError(404, error.message, 'OPENAI_NOT_FOUND');
    case 'rateLimited':
      return new AppError(429, error.message, 'OPENAI_RATE_LIMITED', {
        retryAfter: error.retryAfter,
      });
    case 'network':
      return new AppError(502, error.message, 'OPENAI_UNREACHABLE');
    case 'badRequest':
      return new AppError(400, error.message, 'OPENAI_BAD_REQUEST');
    default:
      return new AppError(502, error.message, 'OPENAI_ERROR');
  }
}

/** Đọc Usage ở cấp tổ chức OpenAI. */
export async function getOrganizationUsage(
  userId: string,
  query: OpenAIUsageQuery,
) {
  assertOrgAccess(userId);

  const result = await fetchOpenAIUsage(query);

  if (!result.supported) {
    throw toAppError(
      result.error ?? {
        kind: 'forbidden',
        message: result.message || ADMIN_KEY_MISSING_MESSAGE,
      },
    );
  }

  return {
    totals: result.totals,
    byModel: result.byModel,
    byProject: result.byProject,
    points: result.points,
    pagination: result.pagination,
    message: result.message,
  };
}

/** Đọc Costs ở cấp tổ chức OpenAI. */
export async function getOrganizationCosts(
  userId: string,
  query: OpenAICostQuery,
) {
  assertOrgAccess(userId);

  const result = await fetchOpenAICosts(query);

  if (!result.supported) {
    throw toAppError(
      result.error ?? {
        kind: 'forbidden',
        message: result.message || ADMIN_KEY_MISSING_MESSAGE,
      },
    );
  }

  return {
    totals: result.totals,
    byDate: result.byDate,
    byProject: result.byProject,
    byLineItem: result.byLineItem,
    points: result.points,
    pagination: result.pagination,
    message: result.message,
  };
}

/** Đọc danh sách model OpenAI bằng Secret API Key. */
export async function getOpenAIModels() {
  const result = await fetchOpenAIModels();

  if (!result.ok) {
    throw toAppError(
      result.error ?? {
        kind: 'unknown',
        message: result.message,
      },
    );
  }

  return { models: result.models, message: result.message };
}
