import { config } from '../../config';
import { findProviderDefinition } from './providers.catalog';
import {
  checkAdminKeyScope,
  fetchOrganizationCosts,
  fetchOrganizationUsage,
  listOpenAIModels,
  type OpenAICostQuery,
  type OpenAICostResult,
  type OpenAIModelsResult,
  type OpenAIUsageQuery,
  type OpenAIUsageResult,
} from './openai.service';
import {
  checkAnthropicAdminKey,
  checkAnthropicConnection,
  fetchAnthropicReports,
  type AnthropicKeyCheckResult,
} from './anthropic.service';

/** Kết quả kiểm tra kết nối tới nhà cung cấp. */
export type ConnectionCheckStatus =
  | 'success'
  | 'invalidKey'
  | 'missingScope'
  | 'unreachable';

/** Trạng thái kiểm tra riêng của một loại khoá (Claude dùng 2 loại). */
export type ProviderKeyCheckStatus =
  | 'connected'
  | 'invalid'
  | 'missingPermissions'
  | 'missingWorkspace'
  | 'missing';

/** Kết quả kiểm tra riêng cho từng loại khoá. */
export interface ProviderKeyCheck {
  status: ProviderKeyCheckStatus;
  message: string;
  httpStatus?: number;
  detail?: string;
}

export interface ConnectionCheckResult {
  status: ConnectionCheckStatus;
  /** Thông điệp tiếng Việt hiển thị cho người dùng. */
  message: string;
  /** Mã HTTP thực tế từ nhà cung cấp (nếu có phản hồi). */
  httpStatus?: number;
  /** Danh sách model đọc được từ nhà cung cấp. */
  models?: string[];
  /** Mô tả lỗi kỹ thuật từ nhà cung cấp. */
  detail?: string;
  /**
   * Trạng thái Secret API Key (kiểm tra độc lập).
   *
   * Chỉ có với Anthropic — nhà cung cấp dùng hai loại khoá tách biệt.
   */
  secretKey?: ProviderKeyCheck;
  /**
   * Trạng thái Admin API Key (kiểm tra độc lập).
   *
   * Chỉ có với Anthropic — nhà cung cấp dùng hai loại khoá tách biệt.
   */
  adminKey?: ProviderKeyCheck;
}

/** Một điểm dữ liệu usage đã chuẩn hoá từ nhà cung cấp. */
export interface ProviderUsagePoint {
  /** Ngày ghi nhận (YYYY-MM-DD). */
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Chi phí do nhà cung cấp báo cáo (USD). */
  cost: number;
  /** Số lượt gọi. */
  requests: number;
  /** Mã dự án ở cấp tổ chức (nếu nhà cung cấp cung cấp). */
  projectId?: string | null;
  /** Token đã được cache (nếu nhà cung cấp cung cấp). */
  cachedInputTokens?: number;
}

export interface ProviderUsageResult {
  supported: boolean;
  points: ProviderUsagePoint[];
  message: string;
  /** Lỗi đã chuẩn hoá (null khi thành công). */
  error?: ProviderErrorInfo;
}

/** Thông tin lỗi chuẩn hoá từ nhà cung cấp. */
export interface ProviderErrorInfo {
  kind: string;
  message: string;
  httpStatus?: number;
  detail?: string;
  retryAfter?: number;
}

/** Khoá trong cache để tránh gọi lại API khi cùng một khoá. */
interface CacheEntry {
  expiresAt: number;
  result: ConnectionCheckResult;
}

const checkCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

function cacheKey(providerType: string, apiKey: string): string {
  return `${providerType}:${apiKey.slice(-8)}:${apiKey.length}`;
}

/** Gọi HTTP tới nhà cung cấp với timeout. */
async function request(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: any; networkError?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.providerRequestTimeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: any = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text.slice(0, 500) };
      }
    }
    return { status: response.status, body };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Không thể kết nối tới nhà cung cấp.';
    return { status: 0, body: null, networkError: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Trích xuất thông điệp lỗi từ payload của nhà cung cấp. */
function extractDetail(body: any): string | undefined {
  if (!body) return undefined;
  if (typeof body === 'string') return body;
  const error = body.error ?? body;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  if (typeof body.message === 'string') return body.message;
  return undefined;
}

/** Chuyển mã HTTP của nhà cung cấp thành trạng thái kiểm tra. */
function mapHttpStatus(status: number, detail?: string): ConnectionCheckResult {
  if (status === 401 || status === 400) {
    return {
      status: 'invalidKey',
      message: 'API Key không hợp lệ.',
      httpStatus: status,
      detail,
    };
  }
  if (status === 403) {
    return {
      status: 'missingScope',
      message: 'API Key thiếu quyền truy cập usage hoặc billing của nhà cung cấp.',
      httpStatus: status,
      detail,
    };
  }
  if (status === 429) {
    return {
      status: 'unreachable',
      message:
        'Nhà cung cấp đang giới hạn tần suất (rate limit). Vui lòng thử lại sau.',
      httpStatus: status,
      detail,
    };
  }
  if (status >= 500) {
    return {
      status: 'unreachable',
      message: 'Không thể kết nối đến nhà cung cấp.',
      httpStatus: status,
      detail,
    };
  }
  return {
    status: 'invalidKey',
    message: 'API Key không hợp lệ.',
    httpStatus: status,
    detail,
  };
}

/** Danh sách model đọc được từ response của nhà cung cấp. */
function parseModels(body: any): string[] {
  if (!body) return [];
  const raw: any[] = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.models)
      ? body.models
      : [];

  const names = raw
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const name = record.id ?? record.name;
        if (typeof name === 'string') return name;
      }
      return null;
    })
    .filter((n): n is string => Boolean(n));

  // Chỉ giữ tối đa 8 model để giao diện gọn gàng.
  return names.slice(0, 8);
}

/**
 * Gọi API kiểm tra kết nối — riêng cho từng nhà cung cấp.
 *
 * OpenAI không dùng hàm này: OpenAI tách Secret API Key (danh sách model) và
 * Admin API Key (Usage/Costs) nên được xử lý riêng trong [checkOpenAIConnection].
 */
async function callProviderModels(
  providerType: string,
  apiKey: string,
): Promise<{ status: number; body: any; networkError?: string }> {
  switch (providerType) {
    case 'anthropic':
      return request('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });
    case 'google':
      return request(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        { headers: {} },
      );
    case 'mistral':
      return request('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    case 'groq':
      return request('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    default:
      return {
        status: 404,
        body: { error: { message: 'Nhà cung cấp chưa được hỗ trợ.' } },
      };
  }
}

/**
 * Kiểm tra API Key có hợp lệ và có quyền đọc usage/billing hay không.
 *
 * - `200` → thành công, đọc được danh sách model.
 * - `401`/`400` → API Key không hợp lệ.
 * - `403` → thiếu quyền truy cập usage/billing.
 * - `429`/`5xx`/lỗi mạng → không thể kết nối tới nhà cung cấp.
 */
export async function checkProviderConnection(
  providerType: string,
  apiKey: string,
  options: {
    skipCache?: boolean;
    /**
     * Admin API Key của người dùng (dùng cho OpenAI và Anthropic) — dùng để
     * kiểm tra quyền đọc Usage & Costs ở cấp tổ chức.
     */
    adminApiKey?: string;
    /**
     * Workspace ID của Anthropic (`wsp_...`) — tuỳ chọn, dùng làm header
     * `anthropic-workspace-id` khi Secret API Key chưa được scope vào
     * Workspace nào. Chỉ có ý nghĩa với Anthropic.
     */
    workspaceId?: string;
  } = {},
): Promise<ConnectionCheckResult> {
  const definition = findProviderDefinition(providerType);
  if (!definition) {
    return {
      status: 'invalidKey',
      message: 'Nhà cung cấp chưa được hỗ trợ.',
    };
  }

  // OpenAI dùng cơ chế hai loại khoá riêng biệt — xử lý riêng.
  if (providerType === 'openai') {
    return checkOpenAIConnection(apiKey, options);
  }

  // Anthropic Claude cũng dùng hai loại khoá tách biệt — xử lý riêng.
  if (providerType === 'anthropic') {
    return checkAnthropicConnectionWithKeys(apiKey, options);
  }

  const key = cacheKey(providerType, apiKey);
  if (!options.skipCache) {
    const cached = checkCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  let result: ConnectionCheckResult;

  const models = await callProviderModels(providerType, apiKey);

  if (models.networkError) {
    result = {
      status: 'unreachable',
      message: 'Không thể kết nối đến nhà cung cấp.',
      detail: models.networkError,
    };
  } else if (models.status >= 200 && models.status < 300) {
    const modelNames = parseModels(models.body);

    // Nhà cung cấp có API usage → thử đọc thử để biết khoá có quyền billing.
    if (definition.supportsUsage) {
      const usage = await fetchProviderUsage(providerType, apiKey, 30);
      if (!usage.supported && usage.points.length === 0) {
        result = {
          status: 'missingScope',
          message: 'API Key hợp lệ nhưng thiếu quyền truy cập usage hoặc billing.',
          httpStatus: models.status,
          models: modelNames,
          detail: usage.message,
        };
      } else {
        result = {
          status: 'success',
          message: 'Kết nối thành công.',
          httpStatus: models.status,
          models: modelNames,
        };
      }
    } else {
      result = {
        status: 'success',
        message:
          'Kết nối thành công. Nhà cung cấp này không công bố API billing.',
        httpStatus: models.status,
        models: modelNames,
      };
    }
  } else {
    result = mapHttpStatus(models.status, extractDetail(models.body));
  }

  checkCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}

/**
 * Kiểm tra kết nối OpenAI.
 *
 * OpenAI tách hai loại khoá:
 * - **Secret API Key** (do người dùng nhập) → đọc danh sách model.
 * - **Admin API Key** (cấu hình trong `.env` của backend) → đọc Usage & Costs
 *   ở cấp tổ chức. Secret key không bao giờ có quyền này.
 *
 * Vì vậy kết nối vẫn `success` khi đọc được model, nhưng `missingScope` nếu
 * Admin API Key chưa được cấu hình hoặc không có quyền đọc Usage/Costs.
 */
async function checkOpenAIConnection(
  apiKey: string,
  options: { skipCache?: boolean; adminApiKey?: string } = {},
): Promise<ConnectionCheckResult> {
  const key = cacheKey('openai', apiKey);
  if (!options.skipCache) {
    const cached = checkCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  // 1. Secret API Key → kiểm tra hợp lệ + đọc danh sách model.
  const models = await listOpenAIModels(apiKey);

  let result: ConnectionCheckResult;

  if (!models.ok) {
    const error = models.error;
    if (error?.kind === 'notConfigured') {
      result = {
        status: 'unreachable',
        message: error.message,
        detail: error.detail,
      };
    } else if (error?.kind === 'unauthorized') {
      result = {
        status: 'invalidKey',
        message: error.message,
        httpStatus: error.httpStatus,
        detail: error.detail,
      };
    } else if (error?.kind === 'forbidden') {
      result = {
        status: 'missingScope',
        message: error.message,
        httpStatus: error.httpStatus,
        detail: error.detail,
      };
    } else if (error?.kind === 'rateLimited') {
      result = {
        status: 'unreachable',
        message: error.message,
        httpStatus: error.httpStatus,
        detail: error.detail,
      };
    } else {
      result = {
        status: 'unreachable',
        message: error?.message ?? 'Không thể kết nối đến OpenAI.',
        httpStatus: error?.httpStatus,
        detail: error?.detail,
      };
    }
  } else {
    const modelNames = models.models.slice(0, 8);

    // 2. Admin API Key của người dùng → kiểm tra quyền đọc Usage/Costs.
    //    Nếu người dùng chưa cung cấp thì fallback về khoá của máy chủ.
    const scopeError = await checkAdminKeyScope(options.adminApiKey);

    if (scopeError) {
      const missingAdminKey =
        scopeError.kind === 'notConfigured' ||
        scopeError.message.includes('OPENAI_ADMIN_API_KEY');

      result = {
        status: 'missingScope',
        message: missingAdminKey
          ? 'Secret API Key hợp lệ và đã đọc được danh sách model, ' +
            'nhưng chưa đọc được dữ liệu Usage/Costs của tổ chức. ' +
            'Hãy nhập Admin API Key của tổ chức OpenAI (mục Organization → ' +
            'Admin keys) để đồng bộ token và chi phí.'
          : 'Secret API Key hợp lệ và đã đọc được danh sách model, ' +
            'nhưng chưa đọc được dữ liệu Usage/Costs của tổ chức. ' +
            'Kiểm tra lại Admin API Key và quyền Usage & Costs trong ' +
            'Organization settings trên OpenAI Platform.',
        httpStatus: scopeError.httpStatus,
        models: modelNames,
        detail: scopeError.message,
      };
    } else {
      result = {
        status: 'success',
        message: 'Kết nối thành công.',
        httpStatus: 200,
        models: modelNames,
      };
    }
  }

  checkCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}

/**
 * Kiểm tra kết nối Anthropic Claude với **hai loại khoá độc lập**.
 *
 * - **Secret API Key** → gọi `/v1/models` để kiểm tra kết nối + đọc model.
 * - **Admin API Key** → gọi `/v1/organizations/usage_report/messages` để kiểm tra
 *   quyền đọc báo cáo tổ chức.
 *
 * Hai kết quả được trả về **riêng biệt** trong `secretKey` / `adminKey` —
 * việc Secret API Key hợp lệ không suy ra được Admin API Key hợp lệ, và
 * ngược lại.
 */
async function checkAnthropicConnectionWithKeys(
  apiKey: string,
  options: {
    skipCache?: boolean;
    adminApiKey?: string;
    workspaceId?: string;
  } = {},
): Promise<ConnectionCheckResult> {
  // 1. Secret API Key → kiểm tra hợp lệ + đọc danh sách model.
  const secret = await checkAnthropicConnection(apiKey, options.workspaceId);

  const secretKey: ProviderKeyCheck = secret.ok
    ? {
        status: 'connected',
        message:
          secret.models.length > 0
            ? `Secret API Key hợp lệ — đã đọc được ${secret.models.length} model.`
            : 'Secret API Key hợp lệ.',
        httpStatus: 200,
      }
    : {
        status:
          secret.error?.kind === 'missingWorkspace'
            ? 'missingWorkspace'
            : 'invalid',
        message: secret.message,
        httpStatus: secret.error?.httpStatus,
        detail: secret.error?.detail,
      };

  // 2. Admin API Key → kiểm tra quyền đọc Usage/Cost ở cấp tổ chức.
  const admin: AnthropicKeyCheckResult = await checkAnthropicAdminKey({
    adminApiKey: options.adminApiKey,
    workspaceId: options.workspaceId,
  });

  const adminKey: ProviderKeyCheck = {
    status: admin.status,
    message: admin.message,
    httpStatus: admin.httpStatus,
    detail: admin.detail,
  };

  // Trạng thái tổng thể: ưu tiên lỗi của Secret API Key (không dùng được
  // nhà cung cấp), sau đó mới tới trạng thái của Admin API Key.
  let status: ConnectionCheckStatus;
  let message: string;

  if (!secret.ok) {
    status =
      secretKey.status === 'missingWorkspace' ? 'missingScope' : 'invalidKey';
    message = secret.message;
  } else if (adminKey.status === 'connected') {
    status = 'success';
    message = 'Kết nối Anthropic thành công.';
  } else if (adminKey.status === 'missingPermissions') {
    status = 'missingScope';
    message = adminKey.message;
  } else if (adminKey.status === 'missingWorkspace') {
    status = 'missingScope';
    message = adminKey.message;
  } else if (adminKey.status === 'missing') {
    // Chưa có Admin API Key → vẫn dùng được Secret API Key cho API thường.
    status = 'success';
    message =
      'Secret API Key hợp lệ. Chưa có Admin API Key nên chưa đồng bộ được ' +
      'Usage & Cost của tổ chức.';
  } else {
    status = 'invalidKey';
    message = adminKey.message;
  }

  return {
    status,
    message,
    httpStatus: secretKey.httpStatus ?? adminKey.httpStatus,
    models: secret.models.slice(0, 8),
    detail:
      secretKey.status === 'connected' ? adminKey.detail : secret.error?.detail,
    secretKey,
    adminKey,
  };
}

/**
 * Đọc usage/billing thật từ nhà cung cấp.
 *
 * - OpenAI: Organization Usage API (`/v1/organization/usage/completions`).
 * - Anthropic: Usage Report (`/v1/organizations/usage_report/messages`) và
 *   Cost Report (`/v1/organizations/cost_report`).
 *
 * Các endpoint này yêu cầu khoá quản trị tổ chức — nếu không có quyền,
 * nhà cung cấp trả về 403 và hàm trả về `supported: false`.
 *
 * @param adminApiKey Admin API Key của người dùng (dùng cho OpenAI và
 *   Anthropic — không bao giờ dùng Secret API Key cho endpoint tổ chức).
 * @param workspaceId Workspace ID của Anthropic (tuỳ chọn).
 */
export async function fetchProviderUsage(
  providerType: string,
  apiKey: string,
  days = 30,
  adminApiKey?: string,
  workspaceId?: string,
): Promise<ProviderUsageResult> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  if (providerType === 'openai') {
    // OpenAI tách hai loại khoá: Usage/Costs ở cấp tổ chức chỉ chấp nhận
    // **Admin API Key**, không phải Secret API Key mà người dùng nhập.
    // Vì vậy ở nhánh này cố tình bỏ qua `apiKey`.
    const startSeconds = Math.floor(start.getTime() / 1000);
    const endSeconds = Math.floor(end.getTime() / 1000);

    const usage = await fetchOrganizationUsage({
      startTime: startSeconds,
      endTime: endSeconds,
      bucketWidth: '1d',
      groupBy: ['model', 'project_id'],
      adminApiKey,
    });

    if (!usage.supported) {
      return {
        supported: false,
        points: [],
        message: usage.message,
        error: usage.error,
      };
    }

    // Chi phí đến từ Organization Costs API (endpoint usage không trả cost).
    const costs = await fetchOrganizationCosts({
      startTime: startSeconds,
      endTime: endSeconds,
      groupBy: ['line_item', 'project_id'],
      adminApiKey,
    });

    // Ghép chi phí vào từng điểm usage theo (ngày, model).
    const costByKey = new Map<string, number>();
    for (const point of costs.points) {
      const model = point.model ?? 'unknown';
      const key = `${point.date}|${model}`;
      costByKey.set(key, (costByKey.get(key) ?? 0) + point.amount);
    }

    const points: ProviderUsagePoint[] = usage.points.map((point) => ({
      date: point.date,
      model: point.model ?? 'unknown',
      inputTokens: point.inputTokens,
      outputTokens: point.outputTokens,
      cost: costByKey.get(`${point.date}|${point.model ?? 'unknown'}`) ?? 0,
      requests: point.requests,
      projectId: point.projectId,
      cachedInputTokens: point.cachedInputTokens,
    }));

    return {
      supported: true,
      points,
      message:
        points.length > 0
          ? `Đã đồng bộ ${points.length} điểm usage từ OpenAI.`
          : 'OpenAI không có dữ liệu usage trong khoảng thời gian này.',
    };
  }

  if (providerType === 'anthropic') {
    // Anthropic tách hai loại khoá: Usage/Cost Report ở cấp tổ chức chỉ chấp
    // nhận **Admin API Key**, không phải Secret API Key mà người dùng nhập.
    // Vì vậy ở nhánh này cố tình bỏ qua `apiKey` cho các endpoint tổ chức.
    const reports = await fetchAnthropicReports(
      { adminApiKey, workspaceId },
      {
        startingAt: Math.floor(start.getTime() / 1000),
        endingAt: Math.floor(end.getTime() / 1000),
        bucketWidth: '1d',
      },
    );

    if (!reports.usage.supported) {
      return {
        supported: false,
        points: [],
        message: reports.usage.message,
        error: reports.usage.error,
      };
    }

    const points: ProviderUsagePoint[] = reports.points.map((point) => ({
      date: point.date,
      model: point.model,
      inputTokens: point.inputTokens,
      outputTokens: point.outputTokens,
      cost: point.cost,
      requests: point.requests,
    }));

    return {
      supported: true,
      points,
      message: reports.message,
    };
  }

  const definition = findProviderDefinition(providerType);
  return {
    supported: false,
    points: [],
    message:
      definition?.usageNote ??
      'Nhà cung cấp này không cung cấp API usage/billing công khai.',
  };
}

/**
 * Đọc dữ liệu Usage ở cấp tổ chức của OpenAI.
 *
 * Dùng Admin API Key (`OPENAI_ADMIN_API_KEY`) — không dùng Secret API Key.
 */
export async function fetchOpenAIUsage(
  query: OpenAIUsageQuery,
): Promise<OpenAIUsageResult> {
  return fetchOrganizationUsage(query);
}

/**
 * Đọc dữ liệu Costs ở cấp tổ chức của OpenAI.
 *
 * Dùng Admin API Key (`OPENAI_ADMIN_API_KEY`) — không dùng Secret API Key.
 */
export async function fetchOpenAICosts(
  query: OpenAICostQuery,
): Promise<OpenAICostResult> {
  return fetchOrganizationCosts(query);
}

/**
 * Đọc danh sách model của OpenAI bằng Secret API Key.
 */
export async function fetchOpenAIModels(): Promise<OpenAIModelsResult> {
  return listOpenAIModels();
}
