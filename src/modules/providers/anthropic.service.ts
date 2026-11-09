import {
  ANTHROPIC_COST_REPORT_PATH,
  ANTHROPIC_MODELS_PATH,
  ANTHROPIC_USAGE_REPORT_PATH,
  anthropicRequest,
  extractAnthropicDetail,
  isWorkspaceScopeError,
  normalizeWorkspaceId,
  toAnthropicError,
  type AnthropicCredentialKind,
  type AnthropicCredentials,
  type AnthropicErrorInfo,
} from './anthropic.client';

/**
 * Tầng nghiệp vụ riêng cho Anthropic Claude.
 *
 * Tách hoàn toàn khỏi `openai.service.ts` — không dùng chung logic, không
 * dùng chung khoá, không dùng chung endpoint.
 *
 * Claude dùng **hai loại khoá tách biệt**:
 *
 * 1. **Secret API Key** → kiểm tra kết nối + đọc danh sách model (`/v1/models`).
 * 2. **Admin API Key** → đọc báo cáo cấp tổ chức:
 *    - Usage: `/v1/organizations/usage_report/messages`
 *    - Cost:  `/v1/organizations/cost_report`
 *
 * Việc kiểm tra Secret API Key **không** suy ra được trạng thái của Admin
 * API Key và ngược lại — mỗi loại có kết quả riêng.
 */

/** Số trang tối đa lấy trong một lần đọc phân trang (chống vòng lặp vô hạn). */
const MAX_PAGES = 50;

/** Bucket width hợp lệ theo endpoint của Anthropic. */
export type AnthropicBucketWidth = '1m' | '1h' | '1d';

/** Trạng thái kiểm tra một loại khoá của Claude. */
export type AnthropicKeyStatus =
  | 'connected'
  | 'invalid'
  | 'missingPermissions'
  | 'missingWorkspace'
  | 'missing';

/** Kết quả kiểm tra kết nối Anthropic. */
export interface AnthropicConnectionResult {
  ok: boolean;
  /** Danh sách model đọc được (rỗng nếu lỗi). */
  models: string[];
  /** Thông điệp tiếng Việt cho giao diện. */
  message: string;
  /** Thông tin lỗi đã chuẩn hoá (null khi thành công). */
  error?: AnthropicErrorInfo;
}

/** Kết quả kiểm tra độc lập từng loại khoá của Claude. */
export interface AnthropicKeyCheckResult {
  /** Trạng thái của loại khoá vừa kiểm tra. */
  status: AnthropicKeyStatus;
  /** Thông điệp tiếng Việt cho giao diện. */
  message: string;
  /** Mã HTTP thực tế từ Anthropic (nếu có). */
  httpStatus?: number;
  /** Chi tiết kỹ thuật do Anthropic trả về (không chứa khoá). */
  detail?: string;
}

/**
 * Kiểm tra **Secret API Key** của Anthropic.
 *
 * Luồng xử lý:
 * - Gọi `/v1/models` với `x-api-key` + `anthropic-version`.
 * - Nếu có Workspace ID → gửi kèm `anthropic-workspace-id`.
 * - Nếu API Key **chưa được scope** và không có Workspace ID → Anthropic trả
 *   400 kèm thông điệp yêu cầu header → báo rõ cho người dùng biết cần
 *   nhập Workspace ID.
 * - Nếu API Key **đã được scope** vào Workspace → mọi thứ hoạt động bình
 *   thường, không cần Workspace ID.
 *
 * @param apiKey Secret API Key của Anthropic (bản rõ, chưa mã hoá).
 * @param workspaceId Workspace ID (tuỳ chọn) — `wrkspc_...`.
 */
export async function checkAnthropicConnection(
  apiKey: string,
  workspaceId?: string,
): Promise<AnthropicConnectionResult> {
  const credentials: AnthropicCredentials = {
    apiKey,
    workspaceId: normalizeWorkspaceId(workspaceId),
  };

  const response = await anthropicRequest(ANTHROPIC_MODELS_PATH, {
    credential: 'secret',
    credentials,
  });

  if (response.status < 200 || response.status >= 300) {
    const error = toAnthropicError(response, 'secret');

    // Anthropic trả 400 "not scoped to a workspace" khi thiếu header.
    // Thông điệp đã được chuẩn hoá trong `toAnthropicError`, nhưng nhánh này
    // đảm bảo chắc chắn người dùng được hướng dẫn nhập Workspace ID.
    if (
      error.kind === 'badRequest' &&
      isWorkspaceScopeError(error.detail)
    ) {
      return {
        ok: false,
        models: [],
        message:
          'API Key này chưa được gán vào Workspace nào. ' +
          'Hãy nhập Anthropic Workspace ID (ví dụ "wrkspc_...") ' +
          'để TokenScope gửi kèm header anthropic-workspace-id.',
        error: { ...error, kind: 'missingWorkspace' },
      };
    }

    return { ok: false, models: [], message: error.message, error };
  }

  const models = parseAnthropicModels(response.body);

  return {
    ok: true,
    models,
    message:
      models.length > 0
        ? `Kết nối Anthropic thành công — đã đọc được ${models.length} model.`
        : 'Kết nối Anthropic thành công.',
  };
}

/**
 * Đọc danh sách model Claude bằng **Secret API Key**.
 *
 * Endpoint `/v1/models` yêu cầu khoá có quyền đọc model — khoá thường dùng để
 * gọi API cũng đọc được.
 */
export async function listAnthropicModels(
  credentials: AnthropicCredentials,
): Promise<AnthropicConnectionResult> {
  const response = await anthropicRequest(ANTHROPIC_MODELS_PATH, {
    credential: 'secret',
    credentials,
  });

  if (response.status < 200 || response.status >= 300) {
    const error = toAnthropicError(response, 'secret');
    return { ok: false, models: [], message: error.message, error };
  }

  const models = parseAnthropicModels(response.body);
  return {
    ok: true,
    models,
    message:
      models.length > 0
        ? `Đã đọc được ${models.length} model từ Anthropic.`
        : 'Anthropic không trả về model nào.',
  };
}

/**
 * Kiểm tra **Admin API Key** của Anthropic có đủ quyền đọc báo cáo tổ chức.
 *
 * Dùng Admin API Key **riêng** — không bao giờ dùng Secret API Key thay thế.
 * Nếu thiếu khoá → trả về `missing` (không phải lỗi).
 */
export async function checkAnthropicAdminKey(
  credentials: AnthropicCredentials,
): Promise<AnthropicKeyCheckResult> {
  const adminKey = (credentials.adminApiKey ?? '').trim();

  if (!adminKey) {
    return {
      status: 'missing',
      message:
        'Chưa cung cấp Admin API Key của Anthropic. ' +
        'Cần khoá quản trị tổ chức để đọc Usage Report và Cost Report.',
    };
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const end = today.getTime() / 1000;
  const response = await anthropicRequest(ANTHROPIC_USAGE_REPORT_PATH, {
    credential: 'admin',
    credentials,
    query: {
      ...reportTimeRange(end - 86_400, end),
      bucket_width: '1d',
      'workspace_ids[]': normalizeWorkspaceId(credentials.workspaceId) || undefined,
      limit: 1,
    },
  });

  if (response.status < 200 || response.status >= 300) {
    const error = toAnthropicError(response, 'admin');

    if (error.kind === 'missingWorkspace') {
      return {
        status: 'missingWorkspace',
        message: error.message,
        httpStatus: error.httpStatus,
        detail: error.detail,
      };
    }

    if (error.kind === 'missingAdminPermissions' || error.kind === 'forbidden') {
      return {
        status: 'missingPermissions',
        message: error.message,
        httpStatus: error.httpStatus,
        detail: error.detail,
      };
    }

    if (error.kind === 'unauthorized') {
      return {
        status: 'invalid',
        message: error.message,
        httpStatus: error.httpStatus,
        detail: error.detail,
      };
    }

    if (error.kind === 'rateLimited') {
      return {
        status: 'invalid',
        message: error.message,
        httpStatus: error.httpStatus,
        detail: error.detail,
      };
    }

    return {
      status: 'invalid',
      message: error.message,
      httpStatus: error.httpStatus,
      detail: error.detail,
    };
  }

  return {
    status: 'connected',
    message: 'Admin API Key hợp lệ — đã đọc được báo cáo Usage của tổ chức.',
  };
}

/** Một điểm usage đã chuẩn hoá từ Anthropic. */
export interface AnthropicUsagePoint {
  /** Ngày `YYYY-MM-DD` (UTC). */
  date: string;
  /** Tên model. */
  model: string;
  /** Tổng token đầu vào (chưa cache + đọc cache + tạo cache). */
  inputTokens: number;
  /** Token đầu ra. */
  outputTokens: number;
  /** Chi phí (USD). */
  cost: number;
  /** Số lượt gọi. */
  requests: number;
}

/** Một điểm chi phí đã chuẩn hoá từ Anthropic Cost Report. */
export interface AnthropicCostPoint {
  /** Ngày `YYYY-MM-DD` (UTC). */
  date: string;
  /** Tên model (nếu có trong response). */
  model: string;
  /** Tên line item / loại phí. */
  lineItem: string | null;
  /** Số tiền (USD). */
  amount: number;
  /** Số token đi kèm (nếu có). */
  quantity: number | null;
  /** Đơn vị của `quantity` (ví dụ `tokens`). */
  quantityUnit: string | null;
}

/** Kết quả đọc Usage Report. */
export interface AnthropicUsageReportResult {
  /** Dữ liệu đọc được hay không (false khi thiếu khoá / thiếu quyền). */
  supported: boolean;
  points: AnthropicUsagePoint[];
  /** Thông tin phân trang sau khi đọc hết các trang. */
  pagination: { pages: number; hasMore: boolean; nextPage: string | null };
  message: string;
  error?: AnthropicErrorInfo;
}

/** Kết quả đọc Cost Report. */
export interface AnthropicCostReportResult {
  supported: boolean;
  points: AnthropicCostPoint[];
  /** Tổng chi phí (USD). */
  totals: { amount: number; currency: string | null };
  pagination: { pages: number; hasMore: boolean; nextPage: string | null };
  message: string;
  error?: AnthropicErrorInfo;
}

/** Tham số đọc báo cáo cấp tổ chức. */
export interface AnthropicReportQuery {
  /** Mốc bắt đầu (Unix giây, bao gồm). */
  startingAt: number;
  /** Mốc kết thúc (Unix giây, không bao gồm). */
  endingAt?: number;
  /** Độ rộng bucket. */
  bucketWidth?: AnthropicBucketWidth;
  /** Danh sách model cần lọc. */
  models?: string[];
  /** Số bucket mỗi trang. */
  limit?: number;
  /** Con trỏ trang (cursor chính thức của Anthropic). */
  page?: string;
}

/**
 * Đọc Usage Report cấp tổ chức bằng **Admin API Key**, tự động lấy hết trang.
 *
 * Endpoint: `/v1/organizations/usage_report/messages`
 * Phân trang: cursor chính thức qua query `page` + body `has_more` / `next_page`.
 */
export async function fetchAnthropicUsageReport(
  credentials: AnthropicCredentials,
  query: AnthropicReportQuery,
): Promise<AnthropicUsageReportResult> {
  const empty: AnthropicUsageReportResult = {
    supported: false,
    points: [],
    pagination: { pages: 0, hasMore: false, nextPage: null },
    message: '',
  };

  const points: AnthropicUsagePoint[] = [];
  let page = query.page;
  let pages = 0;
  let hasMore = false;
  let nextPage: string | null = null;
  const workspaceId = normalizeWorkspaceId(credentials.workspaceId);

  do {
    const response = await anthropicRequest(ANTHROPIC_USAGE_REPORT_PATH, {
      credential: 'admin',
      credentials,
      query: {
        ...reportTimeRange(query.startingAt, query.endingAt),
        bucket_width: query.bucketWidth ?? '1d',
        'models[]': query.models,
        'group_by[]': 'model',
        'workspace_ids[]': workspaceId || undefined,
        limit: query.limit,
        page,
      },
    });

    if (response.status < 200 || response.status >= 300) {
      const error = toAnthropicError(response, 'admin');
      return { ...empty, error, message: error.message };
    }

    pages += 1;

    const buckets: any[] = Array.isArray(response.body?.data)
      ? response.body.data
      : [];

    for (const bucket of buckets) {
      const date = toDateKey(bucket?.starting_at ?? query.startingAt);
      const results: any[] = Array.isArray(bucket?.results) ? bucket.results : [];
      for (const item of results) {
        const cacheCreation = item?.cache_creation;
        const cacheCreationTokens = cacheCreation == null
          ? num(item?.cache_creation_input_tokens)
          : num(cacheCreation.ephemeral_1h_input_tokens) +
            num(cacheCreation.ephemeral_5m_input_tokens);
        const inputTokens =
          num(item?.uncached_input_tokens) +
          num(item?.cache_read_input_tokens) +
          cacheCreationTokens;
        const outputTokens = num(item?.output_tokens);
        const requests = num(item?.request_count);
        if (!inputTokens && !outputTokens && !requests) continue;

        points.push({
          date,
          model: String(item?.model ?? 'unknown'),
          inputTokens,
          outputTokens,
          cost: money(item?.cost_usd),
          requests,
        });
      }
    }

    hasMore = response.body?.has_more === true;
    nextPage =
      typeof response.body?.next_page === 'string' &&
      response.body.next_page.length > 0
        ? response.body.next_page
        : null;
    page = nextPage ?? undefined;
  } while (hasMore && nextPage && pages < MAX_PAGES);

  return {
    supported: true,
    points,
    pagination: { pages, hasMore, nextPage },
    message:
      points.length > 0
        ? `Đã đọc ${points.length} điểm usage từ Anthropic Usage Report.`
        : 'Anthropic không có dữ liệu usage trong khoảng thời gian này.',
  };
}

/**
 * Đọc Cost Report cấp tổ chức bằng **Admin API Key**, tự động lấy hết trang.
 *
 * Endpoint: `/v1/organizations/cost_report`
 */
export async function fetchAnthropicCostReport(
  credentials: AnthropicCredentials,
  query: AnthropicReportQuery,
): Promise<AnthropicCostReportResult> {
  const empty: AnthropicCostReportResult = {
    supported: false,
    points: [],
    totals: { amount: 0, currency: null },
    pagination: { pages: 0, hasMore: false, nextPage: null },
    message: '',
  };

  const points: AnthropicCostPoint[] = [];
  let page = query.page;
  let pages = 0;
  let hasMore = false;
  let nextPage: string | null = null;
  let currency: string | null = null;
  const workspaceId = normalizeWorkspaceId(credentials.workspaceId);
  const groupBy = workspaceId ? ['description', 'workspace_id'] : ['description'];

  do {
    const response = await anthropicRequest(ANTHROPIC_COST_REPORT_PATH, {
      credential: 'admin',
      credentials,
      query: {
        ...reportTimeRange(query.startingAt, query.endingAt),
        bucket_width: '1d',
        'group_by[]': groupBy,
        limit: query.limit,
        page,
      },
    });

    if (response.status < 200 || response.status >= 300) {
      const error = toAnthropicError(response, 'admin');
      return { ...empty, error, message: error.message };
    }

    pages += 1;

    const buckets: any[] = Array.isArray(response.body?.data)
      ? response.body.data
      : [];

    for (const bucket of buckets) {
      const date = toDateKey(bucket?.starting_at ?? query.startingAt);
      const results: any[] = Array.isArray(bucket?.results) ? bucket.results : [];
      for (const item of results) {
        // Cost Report chỉ hỗ trợ gom nhóm theo workspace, nên lọc kết quả sau khi đọc.
        if (workspaceId && item?.workspace_id !== workspaceId) continue;
        const model = String(item?.model ?? 'unknown');
        if (query.models?.length && !query.models.includes(model)) continue;

        // `amount` là USD cent. Các trường USD cũ được giữ để tương thích.
        const legacyAmount = item?.cost_usd ?? item?.amount_usd ?? item?.cost;
        const amount = legacyAmount == null
          ? money(item?.amount) / 100
          : money(legacyAmount);
        const lineItem =
          typeof item?.description === 'string' && item.description.length > 0
            ? item.description
            : typeof item?.line_item === 'string' && item.line_item.length > 0
              ? item.line_item
              : null;

        // Đơn vị tiền tệ có thể nằm ở cấp dòng hoặc cấp response.
        if (!currency && typeof item?.currency === 'string') {
          currency = item.currency;
        }

        points.push({
          date,
          model,
          lineItem,
          amount,
          quantity:
            item?.quantity === null || item?.quantity === undefined
              ? null
              : num(item?.quantity),
          quantityUnit:
            typeof item?.quantity_unit === 'string' ? item.quantity_unit : null,
        });
      }
    }

    const bodyCurrency =
      typeof response.body?.currency === 'string'
        ? response.body.currency
        : null;
    if (!currency && bodyCurrency) currency = bodyCurrency;

    hasMore = response.body?.has_more === true;
    nextPage =
      typeof response.body?.next_page === 'string' &&
      response.body.next_page.length > 0
        ? response.body.next_page
        : null;
    page = nextPage ?? undefined;
  } while (hasMore && nextPage && pages < MAX_PAGES);

  const amount = points.reduce((sum, point) => sum + point.amount, 0);

  return {
    supported: true,
    points,
    totals: { amount, currency },
    pagination: { pages, hasMore, nextPage },
    message:
      points.length > 0
        ? `Đã đọc ${points.length} dòng chi phí từ Anthropic Cost Report.`
        : 'Anthropic không có dữ liệu chi phí trong khoảng thời gian này.',
  };
}

/**
 * Đọc **cả** Usage Report và Cost Report, rồi ghép chi phí vào từng điểm
 * usage theo (ngày, model).
 *
 * Nếu Cost Report không khả dụng → chi phí giữ nguyên từ usage report và
 * thông điệp nói rõ Cost Report unavailable (không tự gán 0).
 */
export async function fetchAnthropicReports(
  credentials: AnthropicCredentials,
  query: AnthropicReportQuery,
): Promise<{
  usage: AnthropicUsageReportResult;
  costs: AnthropicCostReportResult;
  points: AnthropicUsagePoint[];
  message: string;
}> {
  const usage = await fetchAnthropicUsageReport(credentials, query);

  if (!usage.supported) {
    return {
      usage,
      costs: {
        supported: false,
        points: [],
        totals: { amount: 0, currency: null },
        pagination: { pages: 0, hasMore: false, nextPage: null },
        message: 'Usage Report không khả dụng.',
      },
      points: [],
      message: usage.message,
    };
  }

  const costs = await fetchAnthropicCostReport(credentials, query);

  // Ghép chi phí theo (ngày, model).
  const costByKey = new Map<string, number>();
  for (const point of costs.points) {
    const key = `${point.date}|${point.model}`;
    costByKey.set(key, (costByKey.get(key) ?? 0) + point.amount);
  }

  const points = usage.points.map((point) => ({
    ...point,
    cost: costByKey.get(`${point.date}|${point.model}`) ?? point.cost,
  }));

  const messages = [usage.message];
  if (!costs.supported) {
    messages.push('Cost Report không khả dụng: ' + costs.message);
  }

  return {
    usage,
    costs,
    points,
    message: messages.join(' '),
  };
}

/** Anthropic yêu cầu thời gian báo cáo ở định dạng RFC 3339. */
function reportTimeRange(startingAt: number, endingAt?: number) {
  return {
    starting_at: new Date(startingAt * 1000).toISOString(),
    ending_at: endingAt === undefined ? undefined : new Date(endingAt * 1000).toISOString(),
  };
}

/** Lấy ngày UTC từ mốc RFC 3339 hoặc Unix giây. */
function toDateKey(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(typeof value === 'number' ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return '';
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** Số token an toàn (null / NaN → 0). */
function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Số tiền an toàn (null / NaN → 0). */
function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Trích danh sách model từ response của Anthropic. */
function parseAnthropicModels(body: any): string[] {
  if (!body) return [];
  const raw: any[] = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.models)
      ? body.models
      : [];

  return raw
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const name = record.id ?? record.name;
        if (typeof name === 'string') return name;
      }
      return null;
    })
    .filter((name): name is string => Boolean(name));
}

export { extractAnthropicDetail };
