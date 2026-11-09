/**
 * Client HTTP riêng cho Anthropic Claude API.
 *
 * Tách hoàn toàn khỏi `openai.client.ts` — không dùng chung hàm gọi, không
 * dùng chung khoá, không dùng chung endpoint.
 *
 * Claude dùng **hai loại khoá độc lập**:
 *
 * 1. **Secret API Key** (`sk-ant-...`) — dùng cho các API thông thường của
 *    Claude: kiểm tra kết nối, đọc danh sách model, gọi model.
 * 2. **Admin API Key** (`sk-ant-admin...`) — dùng **chỉ** cho các endpoint
 *    quản trị tổ chức:
 *    - `/v1/organizations/usage_report/messages`
 *    - `/v1/organizations/cost_report`
 *
 * Hai loại khoá này dùng chung header `x-api-key` nhưng **không thay thế được
 * cho nhau**: Secret API Key không có quyền đọc báo cáo tổ chức và sẽ bị
 * Anthropic từ chối (401/403). Vì vậy hai khoá luôn được truyền riêng và
 * kiểm tra riêng.
 *
 * Điểm khác biệt quan trọng so với OpenAI:
 *
 * - Xác thực bằng header `x-api-key` (không phải `Authorization: Bearer`).
 * - Bắt buộc có header `anthropic-version: 2023-06-01`.
 * - Nếu API Key **không được scope** vào một Workspace thì mọi request phải
 *   kèm header `anthropic-workspace-id` trỏ tới Workspace cần dùng.
 *   Nếu API Key **đã được scope** vào Workspace thì header này không bắt buộc
 *   (vẫn gửi khi có Workspace ID là an toàn — Anthropic bỏ qua nếu không cần).
 *
 * Workspace ID **không** phải Organization ID:
 * - Organization ID (`org_...`) định danh tổ chức trên Console.
 * - Workspace ID (`wsp_...`) định danh một workspace cụ thể bên trong tổ chức.
 *
 * Workspace ID không bao giờ được hardcode trong mã nguồn — nó đến từ người
 * dùng nhập (mã hoá trong database) hoặc từ biến môi trường của máy chủ.
 */

import { config } from '../../config';

/** Phiên bản API Anthropic bắt buộc. */
export const ANTHROPIC_VERSION = '2023-06-01';

/** Base URL mặc định của Anthropic API. */
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/** Endpoint lấy danh sách model của Anthropic (dùng Secret API Key). */
export const ANTHROPIC_MODELS_PATH = '/v1/models';

/** Endpoint báo cáo usage cấp tổ chức (dùng Admin API Key). */
export const ANTHROPIC_USAGE_REPORT_PATH =
  '/v1/organizations/usage_report/messages';

/** Endpoint báo cáo chi phí cấp tổ chức (dùng Admin API Key). */
export const ANTHROPIC_COST_REPORT_PATH = '/v1/organizations/cost_report';

/** Loại khoá dùng cho một request. */
export type AnthropicCredentialKind = 'secret' | 'admin';

/** Kết quả gọi HTTP tới Anthropic. */
export interface AnthropicResponse {
  /** Mã HTTP thực tế (0 nếu lỗi mạng / timeout). */
  status: number;
  /** Body đã parse JSON (null nếu rỗng hoặc lỗi mạng). */
  body: any;
  /** Mô tả lỗi mạng / timeout (nếu có). */
  networkError?: string;
  /** Header `retry-after` nếu Anthropic trả về khi bị rate limit. */
  retryAfter?: string;
}

/** Loại lỗi chuẩn hoá của Anthropic. */
export type AnthropicErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'missingAdminPermissions'
  | 'missingWorkspace'
  | 'missingAdminKey'
  | 'badRequest'
  | 'notFound'
  | 'rateLimited'
  | 'serverError'
  | 'network'
  | 'unknown';

/** Thông tin lỗi đã chuẩn hoá — dùng để trả thông điệp tiếng Việt cho UI. */
export interface AnthropicErrorInfo {
  kind: AnthropicErrorKind;
  /** Thông điệp tiếng Việt, thân thiện với người dùng. */
  message: string;
  /** Mã HTTP thực tế từ Anthropic. */
  httpStatus?: number;
  /** Chi tiết kỹ thuật do Anthropic trả về (không chứa khoá). */
  detail?: string;
  /** Số giây cần chờ trước khi thử lại (khi bị rate limit). */
  retryAfter?: number;
}

/**
 * Khoá + workspace dùng cho một lần gọi Anthropic.
 *
 * `apiKey` và `adminApiKey` là hai giá trị **độc lập** — không có logic tự
 * động dùng khoá này cho khoá kia. Người gọi phải chỉ định rõ.
 */
export interface AnthropicCredentials {
  /** Secret API Key (đã giải mã) — dùng cho API thông thường. */
  apiKey?: string;
  /** Admin API Key (đã giải mã) — dùng cho endpoint quản trị tổ chức. */
  adminApiKey?: string;
  /** Workspace ID (đã giải mã) — tuỳ chọn. */
  workspaceId?: string;
}

/** Chuẩn hoá Workspace ID: bỏ khoảng trắng thừa. */
export function normalizeWorkspaceId(workspaceId?: string | null): string {
  return (workspaceId ?? '').trim();
}

/**
 * Chọn khoá theo loại credential — tuyệt đối không tự động thay thế.
 *
 * - `secret` → Secret API Key, fallback về `ANTHROPIC_API_KEY` của máy chủ.
 * - `admin` → Admin API Key, fallback về `ANTHROPIC_ADMIN_API_KEY` của máy chủ.
 */
export function resolveAnthropicKey(
  kind: AnthropicCredentialKind,
  credentials: AnthropicCredentials,
): string {
  if (kind === 'admin') {
    return (credentials.adminApiKey ?? '').trim() || config.anthropic.adminApiKey;
  }
  return (credentials.apiKey ?? '').trim() || config.anthropic.apiKey;
}

/**
 * Dựng header cho một request tới Anthropic.
 *
 * - `x-api-key` — khoá xác thực (secret hoặc admin, tuỳ `kind`).
 * - `anthropic-version` — bắt buộc theo yêu cầu của Anthropic.
 * - `content-type: application/json` — nội dung request.
 * - `anthropic-workspace-id` — chỉ dùng cho khoá Secret khi có Workspace ID.
 */
export function buildAnthropicHeaders(
  kind: AnthropicCredentialKind,
  credentials: AnthropicCredentials,
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-api-key': resolveAnthropicKey(kind, credentials),
    'anthropic-version': ANTHROPIC_VERSION,
    'Content-Type': 'application/json',
  };

  const workspaceId = normalizeWorkspaceId(credentials.workspaceId);
  if (kind === 'secret' && workspaceId) {
    headers['anthropic-workspace-id'] = workspaceId;
  }

  return headers;
}

/**
 * Gọi HTTP tới Anthropic với timeout.
 *
 * Không log, không đưa API Key vào thông điệp lỗi.
 */
export async function anthropicRequest(
  path: string,
  options: {
    /** Loại khoá dùng cho request này. */
    credential: AnthropicCredentialKind;
    credentials: AnthropicCredentials;
    method?: 'GET' | 'POST';
    query?: Record<string, string | number | string[] | undefined>;
  },
): Promise<AnthropicResponse> {
  const apiKey = resolveAnthropicKey(options.credential, options.credentials);

  if (!apiKey) {
    return {
      status: 0,
      body: null,
      networkError:
        options.credential === 'admin'
          ? 'ADMIN_API_KEY_NOT_CONFIGURED'
          : 'API_KEY_NOT_CONFIGURED',
    };
  }

  const base = (config.anthropic.baseUrl || ANTHROPIC_BASE_URL).replace(
    /\/+$/,
    '',
  );
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    config.providerRequestTimeoutMs,
  );

  try {
    const response = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers: buildAnthropicHeaders(options.credential, options.credentials),
      signal: controller.signal,
    });

    const text = await response.text();
    let body: any = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text.slice(0, 500) };
      }
    }

    return {
      status: response.status,
      body,
      retryAfter: response.headers.get('retry-after') ?? undefined,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Không thể kết nối tới Anthropic.';
    const isTimeout =
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError');
    return {
      status: 0,
      body: null,
      networkError: isTimeout
        ? 'REQUEST_TIMEOUT'
        : `NETWORK_ERROR: ${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Trích xuất thông điệp lỗi từ payload của Anthropic. */
export function extractAnthropicDetail(body: any): string | undefined {
  if (!body) return undefined;
  const error = body.error ?? body;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  if (typeof body.message === 'string') return body.message;
  return undefined;
}

/**
 * Kiểm tra xem thông điệp lỗi của Anthropic có nói tới Workspace hay không.
 *
 * Anthropic trả về 400 với thông điệp kiểu:
 * "This API key is not scoped to a workspace, so this request must include
 *  the anthropic-workspace-id header with the ID of the workspace to use."
 */
export function isWorkspaceScopeError(detail?: string): boolean {
  if (!detail) return false;
  const text = detail.toLowerCase();
  return (
    text.includes('anthropic-workspace-id') ||
    text.includes('not scoped to a workspace') ||
    text.includes('workspace id')
  );
}

/**
 * Chuyển phản hồi lỗi của Anthropic thành thông tin lỗi chuẩn hoá.
 *
 * Thông điệp phụ thuộc vào loại khoá đã dùng:
 * - `secret` → lỗi nói về Secret API Key (khoá thường).
 * - `admin` → lỗi nói về Admin API Key (khoá quản trị tổ chức) và quyền
 *   đọc Usage/Cost ở cấp tổ chức.
 *
 * Không bao giờ quy đổi mọi lỗi thành "API Key không hợp lệ" — rate limit,
 * lỗi máy chủ và lỗi mạng đều có thông điệp riêng.
 */
export function toAnthropicError(
  response: AnthropicResponse,
  kind: AnthropicCredentialKind = 'secret',
): AnthropicErrorInfo {
  const detail = extractAnthropicDetail(response.body);
  const isAdmin = kind === 'admin';

  if (response.networkError === 'ADMIN_API_KEY_NOT_CONFIGURED') {
    return {
      kind: 'missingAdminKey',
      message:
        'Chưa cung cấp Admin API Key của Anthropic. ' +
        'Cần khoá quản trị tổ chức để đọc Usage Report và Cost Report.',
      httpStatus: response.status,
      detail,
    };
  }

  if (response.networkError === 'API_KEY_NOT_CONFIGURED') {
    return {
      kind: 'unknown',
      message: 'Chưa cung cấp Secret API Key của Anthropic.',
      httpStatus: response.status,
      detail,
    };
  }

  if (response.networkError === 'REQUEST_TIMEOUT') {
    return {
      kind: 'network',
      message:
        'Anthropic không phản hồi trong thời gian cho phép. Vui lòng thử lại sau.',
      httpStatus: response.status,
      detail: 'REQUEST_TIMEOUT',
    };
  }

  if (response.networkError) {
    return {
      kind: 'network',
      message:
        'Không thể kết nối tới Anthropic. Kiểm tra kết nối mạng của máy chủ.',
      httpStatus: response.status,
      detail: response.networkError,
    };
  }

  switch (response.status) {
    case 400:
      // Anthropic trả 400 khi API Key chưa scope và thiếu header workspace.
      if (isWorkspaceScopeError(detail)) {
        return {
          kind: 'missingWorkspace',
          message:
            'Khoá này chưa được gán vào Workspace nào. ' +
            'Hãy nhập Anthropic Workspace ID (bắt đầu bằng "wsp_") ' +
            'để TokenScope gửi kèm header anthropic-workspace-id.',
          httpStatus: 400,
          detail,
        };
      }
      return {
        kind: 'badRequest',
        message:
          detail ??
          'Anthropic không chấp nhận tham số yêu cầu. Kiểm tra lại tham số đã gửi.',
        httpStatus: 400,
        detail,
      };
    case 401:
      return {
        kind: 'unauthorized',
        message: isAdmin
          ? 'Admin API Key của Anthropic không hợp lệ hoặc đã bị thu hồi. ' +
            'Kiểm tra lại khoá tại console.anthropic.com/settings/admin-keys.'
          : 'Secret API Key của Anthropic không hợp lệ hoặc đã bị thu hồi. ' +
            'Kiểm tra lại khoá tại console.anthropic.com/settings/keys.',
        httpStatus: 401,
        detail,
      };
    case 403:
      return {
        kind: isAdmin ? 'missingAdminPermissions' : 'forbidden',
        message: isAdmin
          ? 'Admin API Key này thiếu quyền đọc dữ liệu Usage/Cost của tổ chức. ' +
            'Cần khoá quản trị tổ chức có quyền đọc Usage & Costs ' +
            '(Organization settings trên Anthropic Console).'
          : 'Khoá này không có quyền truy cập Workspace đã chỉ định. ' +
            'Kiểm tra lại Workspace ID hoặc quyền của API Key trên Anthropic Console.',
        httpStatus: 403,
        detail,
      };
    case 404:
      return {
        kind: 'notFound',
        message: isAdmin
          ? 'Endpoint quản trị của Anthropic không tồn tại hoặc khoá không được ' +
            'phép truy cập. Kiểm tra lại loại khoá đang dùng.'
          : 'Endpoint Anthropic không tồn tại. Kiểm tra lại đường dẫn hoặc loại dữ liệu được yêu cầu.',
        httpStatus: 404,
        detail,
      };
    case 429: {
      const retryAfter = response.retryAfter ? Number(response.retryAfter) : undefined;
      return {
        kind: 'rateLimited',
        message:
          'Anthropic đang giới hạn tần suất request. Vui lòng thử lại sau ít phút.',
        httpStatus: 429,
        detail,
        retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
      };
    }
    default:
      break;
  }

  if (response.status >= 500) {
    return {
      kind: 'serverError',
      message:
        'Anthropic đang gặp sự cố tạm thời. Vui lòng thử lại sau ít phút.',
      httpStatus: response.status,
      detail,
    };
  }

  return {
    kind: 'unknown',
    message: detail ?? `Anthropic trả về lỗi ${response.status}.`,
    httpStatus: response.status,
    detail,
  };
}
