import { config } from '../../config';

/**
 * Client HTTP cho OpenAI Platform API.
 *
 * Kiến trúc:
 * - **Secret API Key** → dùng cho `/v1/models` (và các API gọi model nếu có).
 *   KHÔNG dùng cho Usage/Costs.
 * - **Admin API Key** → dùng cho Organization Usage API và Organization Costs
 *   API. Mỗi người dùng cấu hình khoá admin của **tổ chức OpenAI của họ**,
 *   lưu mã hoá trong `api_providers.adminKeyCipher`.
 *
 * Mọi khoá đều đến từ phía người dùng (mã hoá trong DB) hoặc từ biến môi
 * trường của máy chủ — không hardcode, không ghi log, không trả về frontend.
 */

/** Kết quả gọi HTTP tới OpenAI. */
export interface OpenAIResponse {
  /** Mã HTTP thực tế (0 nếu lỗi mạng / timeout). */
  status: number;
  /** Body đã parse JSON (null nếu rỗng hoặc lỗi mạng). */
  body: any;
  /** Mô tả lỗi mạng / timeout (nếu có). */
  networkError?: string;
  /** Header `retry-after` nếu OpenAI trả về khi bị rate limit. */
  retryAfter?: string;
}

/** Lỗi chuẩn hoá theo mã HTTP của OpenAI. */
export type OpenAIErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'notConfigured'
  | 'notFound'
  | 'rateLimited'
  | 'badRequest'
  | 'serverError'
  | 'network'
  | 'unknown';

/** Thông tin lỗi đã chuẩn hoá — dùng để trả thông điệp tiếng Việt cho UI. */
export interface OpenAIErrorInfo {
  kind: OpenAIErrorKind;
  /** Thông điệp tiếng Việt, thân thiện với người dùng. */
  message: string;
  /** Mã HTTP thực tế từ OpenAI. */
  httpStatus?: number;
  /** Chi tiết kỹ thuật do OpenAI trả về (không chứa khoá). */
  detail?: string;
  /** Số giây cần chờ trước khi thử lại (khi bị rate limit). */
  retryAfter?: number;
}

/** Loại khoá dùng cho request. */
export type OpenAICredential = 'secret' | 'admin';

/**
 * Gọi HTTP tới OpenAI với timeout.
 *
 * Header `Authorization` được dựng từ khoá tương ứng — Admin key chỉ được
 * truyền cho các endpoint Organization.
 *
 * @param apiKeyOverride Khoá dùng thay cho khoá trong cấu hình. Dùng khi cần
 *   kiểm tra một khoá do người dùng nhập (không phải khoá của máy chủ).
 * @param adminApiKeyOverride Admin API Key của người dùng (đã giải mã). Nếu
 *   có thì dùng khoá này cho credential `admin`, ngược lại mới fallback về
 *   `OPENAI_ADMIN_API_KEY` của máy chủ.
 */
export async function openAIRequest(
  path: string,
  options: {
    credential: OpenAICredential;
    method?: 'GET' | 'POST';
    query?: Record<string, string | number | string[] | undefined>;
    apiKeyOverride?: string;
    adminApiKeyOverride?: string;
  },
): Promise<OpenAIResponse> {
  const apiKey =
    options.credential === 'admin'
      ? options.adminApiKeyOverride || config.openai.adminApiKey
      : options.apiKeyOverride || config.openai.apiKey;

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

  const url = new URL(`${config.openai.baseUrl}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      // OpenAI nhận mảng query param theo dạng lặp lại: `group_by=model&group_by=project_id`
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
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
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
      error instanceof Error ? error.message : 'Không thể kết nối tới OpenAI.';
    // AbortError = vượt quá thời gian chờ.
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

/** Trích xuất thông điệp lỗi từ payload của OpenAI. */
export function extractOpenAIDetail(body: any): string | undefined {
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
 * Chuyển phản hồi lỗi của OpenAI thành thông tin lỗi chuẩn hoá.
 *
 * Mỗi trường hợp được xử lý riêng để người dùng biết chính xác cần làm gì:
 * - `401` → API Key không hợp lệ.
 * - `403` → Thiếu quyền Organization / Admin API Key.
 * - `404` → Endpoint không tồn tại.
 * - `429` → Vượt giới hạn request.
 * - `5xx` / lỗi mạng → OpenAI không phản hồi.
 */
export function toOpenAIError(response: OpenAIResponse): OpenAIErrorInfo {
  const detail = extractOpenAIDetail(response.body);

  if (response.networkError === 'ADMIN_API_KEY_NOT_CONFIGURED') {
    return {
      kind: 'notConfigured',
      message:
        'Chưa cấu hình OPENAI_ADMIN_API_KEY trên máy chủ. ' +
        'Hãy thêm khoá Admin API Key của tổ chức vào file .env rồi khởi động lại backend.',
      httpStatus: response.status,
      detail,
    };
  }

  if (response.networkError === 'API_KEY_NOT_CONFIGURED') {
    return {
      kind: 'notConfigured',
      message:
        'Chưa cấu hình OPENAI_API_KEY trên máy chủ. ' +
        'Hãy thêm Secret API Key vào file .env rồi khởi động lại backend.',
      httpStatus: response.status,
      detail,
    };
  }

  if (response.networkError === 'REQUEST_TIMEOUT') {
    return {
      kind: 'network',
      message:
        'OpenAI không phản hồi trong thời gian cho phép. Vui lòng thử lại sau.',
      httpStatus: response.status,
      detail: 'REQUEST_TIMEOUT',
    };
  }

  if (response.networkError) {
    return {
      kind: 'network',
      message:
        'Không thể kết nối tới OpenAI. Kiểm tra kết nối mạng của máy chủ.',
      httpStatus: response.status,
      detail: response.networkError,
    };
  }

  switch (response.status) {
    case 401:
      return {
        kind: 'unauthorized',
        message:
          'API Key không hợp lệ hoặc đã bị thu hồi. Kiểm tra lại khoá trên OpenAI Platform.',
        httpStatus: 401,
        detail,
      };
    case 403:
      return {
        kind: 'forbidden',
        message:
          'Khoá này không có quyền truy cập dữ liệu Organization. ' +
          'Cần dùng Admin API Key của tổ chức (mục Usage & Costs trên OpenAI Platform) ' +
          'và bật quyền đọc Usage/Costs cho tổ chức.',
        httpStatus: 403,
        detail,
      };
    case 404:
      return {
        kind: 'notFound',
        message:
          'Endpoint OpenAI không tồn tại. Kiểm tra lại đường dẫn hoặc loại dữ liệu được yêu cầu.',
        httpStatus: 404,
        detail,
      };
    case 429: {
      const retryAfter = response.retryAfter
        ? Number(response.retryAfter)
        : undefined;
      return {
        kind: 'rateLimited',
        message:
          'OpenAI đang giới hạn tần suất request. Vui lòng thử lại sau ít phút.',
        httpStatus: 429,
        detail,
        retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
      };
    }
    default:
      break;
  }

  if (response.status === 400) {
    return {
      kind: 'badRequest',
      message:
        detail ?? 'OpenAI không chấp nhận tham số truy vấn. Kiểm tra lại khoảng thời gian và tham số lọc.',
      httpStatus: 400,
      detail,
    };
  }

  if (response.status >= 500) {
    return {
      kind: 'serverError',
      message:
        'OpenAI đang gặp sự cố tạm thời. Vui lòng thử lại sau ít phút.',
      httpStatus: response.status,
      detail,
    };
  }

  return {
    kind: 'unknown',
    message: detail ?? `OpenAI trả về lỗi ${response.status}.`,
    httpStatus: response.status,
    detail,
  };
}

/** Chuyển mã Unix giây sang chuỗi ngày `YYYY-MM-DD` (theo UTC). */
export function unixToDateKey(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}
