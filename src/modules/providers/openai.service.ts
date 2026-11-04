import { config } from '../../config';
import {
  openAIRequest,
  toOpenAIError,
  unixToDateKey,
  type OpenAIErrorInfo,
} from './openai.client';

/**
 * Tầng nghiệp vụ cho dữ liệu OpenAI Organization (Usage & Costs).
 *
 * Yêu cầu bắt buộc: các endpoint `/v1/organization/*` chỉ chấp nhận
 * **Admin API Key** (`OPENAI_ADMIN_API_KEY`). Secret API Key sẽ bị OpenAI từ
 * chối với mã 403 — vì vậy hai loại khoá được tách hoàn toàn ở đây.
 */

/** Endpoint OpenAI dùng cho từng loại dữ liệu. */
const USAGE_COMPLETIONS_PATH = '/v1/organization/usage/completions';
const COSTS_PATH = '/v1/organization/costs';
const MODELS_PATH = '/v1/models';

/** Số trang tối đa lấy trong một lần đọc phân trang (chống vòng lặp vô hạn). */
const MAX_PAGES = 50;

/** Bucket width hợp lệ theo endpoint của OpenAI. */
export type BucketWidth = '1m' | '1h' | '1d';

/** Trường dùng để gom nhóm dữ liệu. */
export type UsageGroupBy =
  | 'project_id'
  | 'user_id'
  | 'api_key_id'
  | 'model'
  | 'batch'
  | 'service_tier'
  | 'api_source';

export type CostGroupBy =
  | 'project_id'
  | 'user_id'
  | 'line_item'
  | 'api_key_id'
  | 'api_source';

/** Tham số đọc Usage của tổ chức. */
export interface OpenAIUsageQuery {
  /** Mốc bắt đầu (Unix giây, bao gồm). */
  startTime: number;
  /** Mốc kết thúc (Unix giây, không bao gồm). */
  endTime?: number;
  bucketWidth?: BucketWidth;
  projectIds?: string[];
  models?: string[];
  groupBy?: UsageGroupBy[];
  /** Số bucket mỗi trang. */
  limit?: number;
  /** Con trỏ trang (từ `next_page` của trang trước). */
  page?: string;
  /**
   * Admin API Key của người dùng (đã giải mã) để đọc dữ liệu tổ chức của họ.
   * Nếu không có thì fallback về `OPENAI_ADMIN_API_KEY` của máy chủ.
   */
  adminApiKey?: string;
}

/** Tham số đọc Costs của tổ chức. */
export interface OpenAICostQuery {
  startTime: number;
  endTime?: number;
  bucketWidth?: '1d';
  projectIds?: string[];
  lineItems?: string[];
  groupBy?: CostGroupBy[];
  limit?: number;
  page?: string;
  /** Admin API Key của người dùng (đã giải mã). */
  adminApiKey?: string;
}

/** Một điểm usage đã chuẩn hoá. */
export interface OpenAIUsagePoint {
  /** Ngày theo `YYYY-MM-DD` (UTC). */
  date: string;
  /** Mã dự án của OpenAI (null nếu không gom nhóm theo project). */
  projectId: string | null;
  /** Tên model (null nếu không gom nhóm theo model). */
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Tổng token = input + output. */
  totalTokens: number;
  /** Số lượt gọi model. */
  requests: number;
  /** Token đã cache (nếu OpenAI cung cấp). */
  cachedInputTokens: number;
}

/** Một điểm chi phí đã chuẩn hoá. */
export interface OpenAICostPoint {
  date: string;
  projectId: string | null;
  /** Tên line item (ví dụ `gpt-4o, input_tokens`) nếu gom nhóm theo line_item. */
  lineItem: string | null;
  /** Model suy ra từ line_item (phần trước dấu phẩy đầu tiên). */
  model: string | null;
  /** Số tiền theo đơn vị `currency`. */
  amount: number;
  /** Đơn vị tiền tệ do OpenAI trả về (ISO-4211 lowercase, ví dụ `usd`). */
  currency: string | null;
  /** Số lượng đi kèm (chỉ có khi gom nhóm theo line_item). */
  quantity: number | null;
  quantityUnit: string | null;
}

/** Tổng hợp số liệu usage. */
export interface OpenAIUsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  cachedInputTokens: number;
}

/** Tổng hợp số liệu chi phí — không quy đổi đơn vị tiền tệ. */
export interface OpenAICostTotals {
  /** Tổng theo từng đơn vị tiền tệ (không quy đổi). */
  byCurrency: { currency: string | null; amount: number }[];
  /**
   * Tổng chi phí khi tất cả các dòng cùng một đơn vị tiền tệ.
   * `null` nếu dữ liệu có nhiều đơn vị tiền tệ khác nhau.
   */
  amount: number | null;
  currency: string | null;
}

/** Kết quả đọc Usage. */
export interface OpenAIUsageResult {
  /** Dữ liệu đọc được hay không (false khi thiếu key / thiếu quyền). */
  supported: boolean;
  points: OpenAIUsagePoint[];
  totals: OpenAIUsageTotals;
  /** Gom nhóm theo model. */
  byModel: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requests: number;
  }[];
  /** Gom nhóm theo dự án. */
  byProject: {
    projectId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requests: number;
  }[];
  /** Thông tin phân trang sau khi đọc hết các trang. */
  pagination: { pages: number; hasMore: boolean; nextPage: string | null };
  /** Thông điệp cho người dùng. */
  message: string;
  /** Lỗi đã chuẩn hoá (null khi thành công). */
  error?: OpenAIErrorInfo;
}

/** Kết quả đọc Costs. */
export interface OpenAICostResult {
  supported: boolean;
  points: OpenAICostPoint[];
  totals: OpenAICostTotals;
  /** Gom nhóm theo thời gian. */
  byDate: { date: string; amount: number; currency: string | null }[];
  /** Gom nhóm theo dự án. */
  byProject: { projectId: string; amount: number; currency: string | null }[];
  /** Gom nhóm theo loại chi phí (line item). */
  byLineItem: { lineItem: string; amount: number; currency: string | null }[];
  pagination: { pages: number; hasMore: boolean; nextPage: string | null };
  message: string;
  error?: OpenAIErrorInfo;
}

/** Kết quả đọc danh sách model. */
export interface OpenAIModelsResult {
  ok: boolean;
  models: string[];
  message: string;
  error?: OpenAIErrorInfo;
}

/**
 * Đọc danh sách model bằng **Secret API Key**.
 *
 * Khoá Admin không bao giờ được dùng cho endpoint này.
 *
 * @param apiKeyOverride Khoá cụ thể (ví dụ khoá người dùng nhập) thay cho
 *   `OPENAI_API_KEY` của máy chủ.
 */
export async function listOpenAIModels(
  apiKeyOverride?: string,
): Promise<OpenAIModelsResult> {
  const response = await openAIRequest(MODELS_PATH, {
    credential: 'secret',
    apiKeyOverride,
  });

  if (response.status < 200 || response.status >= 300) {
    const error = toOpenAIError(response);
    return { ok: false, models: [], message: error.message, error };
  }

  const raw: any[] = Array.isArray(response.body?.data) ? response.body.data : [];
  const models = raw
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const id = (item as Record<string, unknown>).id;
        if (typeof id === 'string') return id;
      }
      return null;
    })
    .filter((id): id is string => Boolean(id));

  return {
    ok: true,
    models,
    message:
      models.length > 0
        ? `Đã đọc được ${models.length} model từ OpenAI.`
        : 'OpenAI không trả về model nào.',
  };
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

/** Lấy `project_id` nếu OpenAI trả về. */
function projectIdOf(result: any): string | null {
  const value = result?.project_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Lấy `model` nếu OpenAI trả về. */
function modelOf(result: any): string | null {
  const value = result?.model;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Suy ra model từ `line_item`.
 *
 * OpenAI trả `line_item` theo dạng `<model>, <loại phí>` (ví dụ
 * `gpt-4o, input_tokens`) hoặc chỉ tên loại phí cho các dòng không gắn với
 * model (ví dụ `Batch API Discounts`).
 */
export function modelFromLineItem(lineItem: string | null): string | null {
  if (!lineItem) return null;
  const [head] = lineItem.split(',');
  const model = head.trim();
  return model.length > 0 ? model : null;
}

/**
 * Đọc Usage của tổ chức bằng Admin API Key, tự động lấy hết các trang.
 */
export async function fetchOrganizationUsage(
  query: OpenAIUsageQuery,
): Promise<OpenAIUsageResult> {
  const empty: OpenAIUsageResult = {
    supported: false,
    points: [],
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requests: 0,
      cachedInputTokens: 0,
    },
    byModel: [],
    byProject: [],
    pagination: { pages: 0, hasMore: false, nextPage: null },
    message: '',
  };

  const points: OpenAIUsagePoint[] = [];
  let page = query.page;
  let pages = 0;
  let hasMore = false;
  let nextPage: string | null = null;

  do {
    const response = await openAIRequest(USAGE_COMPLETIONS_PATH, {
      credential: 'admin',
      adminApiKeyOverride: query.adminApiKey,
      query: {
        start_time: query.startTime,
        end_time: query.endTime,
        bucket_width: query.bucketWidth ?? '1d',
        project_ids: query.projectIds,
        models: query.models,
        group_by: query.groupBy ?? ['model', 'project_id'],
        limit: query.limit,
        page,
      },
    });

    if (response.status < 200 || response.status >= 300) {
      const error = toOpenAIError(response);
      return { ...empty, error, message: error.message };
    }

    pages += 1;

    const buckets: any[] = Array.isArray(response.body?.data)
      ? response.body.data
      : [];

    for (const bucket of buckets) {
      const date = unixToDateKey(Number(bucket?.start_time ?? 0));
      const results: any[] = Array.isArray(bucket?.results) ? bucket.results : [];
      for (const item of results) {
        const inputTokens = num(item?.input_tokens);
        const outputTokens = num(item?.output_tokens);
        const requests = num(item?.num_model_requests);
        const cachedInputTokens = num(item?.input_cached_tokens);
        if (!inputTokens && !outputTokens && !requests) continue;

        points.push({
          date,
          projectId: projectIdOf(item),
          model: modelOf(item),
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          requests,
          cachedInputTokens,
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
    totals: aggregateUsageTotals(points),
    byModel: aggregateUsageByModel(points),
    byProject: aggregateUsageByProject(points),
    pagination: { pages, hasMore, nextPage },
    message:
      points.length > 0
        ? `Đã đọc ${points.length} điểm usage từ OpenAI Organization.`
        : 'OpenAI không có dữ liệu usage trong khoảng thời gian này.',
  };
}

/** Tổng hợp token từ các điểm usage. */
export function aggregateUsageTotals(
  points: OpenAIUsagePoint[],
): OpenAIUsageTotals {
  return points.reduce<OpenAIUsageTotals>(
    (acc, point) => ({
      inputTokens: acc.inputTokens + point.inputTokens,
      outputTokens: acc.outputTokens + point.outputTokens,
      totalTokens: acc.totalTokens + point.totalTokens,
      requests: acc.requests + point.requests,
      cachedInputTokens: acc.cachedInputTokens + point.cachedInputTokens,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requests: 0,
      cachedInputTokens: 0,
    },
  );
}

/** Gom nhóm usage theo model. */
export function aggregateUsageByModel(points: OpenAIUsagePoint[]) {
  const map = new Map<
    string,
    {
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      requests: number;
    }
  >();

  for (const point of points) {
    const key = point.model ?? 'unknown';
    const current = map.get(key) ?? {
      model: key,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requests: 0,
    };
    current.inputTokens += point.inputTokens;
    current.outputTokens += point.outputTokens;
    current.totalTokens += point.totalTokens;
    current.requests += point.requests;
    map.set(key, current);
  }

  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Gom nhóm usage theo dự án. */
export function aggregateUsageByProject(points: OpenAIUsagePoint[]) {
  const map = new Map<
    string,
    {
      projectId: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      requests: number;
    }
  >();

  for (const point of points) {
    if (!point.projectId) continue;
    const current = map.get(point.projectId) ?? {
      projectId: point.projectId,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requests: 0,
    };
    current.inputTokens += point.inputTokens;
    current.outputTokens += point.outputTokens;
    current.totalTokens += point.totalTokens;
    current.requests += point.requests;
    map.set(point.projectId, current);
  }

  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

/**
 * Đọc Costs của tổ chức bằng Admin API Key, tự động lấy hết các trang.
 */
export async function fetchOrganizationCosts(
  query: OpenAICostQuery,
): Promise<OpenAICostResult> {
  const empty: OpenAICostResult = {
    supported: false,
    points: [],
    totals: { byCurrency: [], amount: null, currency: null },
    byDate: [],
    byProject: [],
    byLineItem: [],
    pagination: { pages: 0, hasMore: false, nextPage: null },
    message: '',
  };

  const points: OpenAICostPoint[] = [];
  let page = query.page;
  let pages = 0;
  let hasMore = false;
  let nextPage: string | null = null;

  do {
    const response = await openAIRequest(COSTS_PATH, {
      credential: 'admin',
      adminApiKeyOverride: query.adminApiKey,
      query: {
        start_time: query.startTime,
        end_time: query.endTime,
        bucket_width: query.bucketWidth ?? '1d',
        project_ids: query.projectIds,
        line_items: query.lineItems,
        group_by: query.groupBy ?? ['line_item', 'project_id'],
        limit: query.limit,
        page,
      },
    });

    if (response.status < 200 || response.status >= 300) {
      const error = toOpenAIError(response);
      return { ...empty, error, message: error.message };
    }

    pages += 1;

    const buckets: any[] = Array.isArray(response.body?.data)
      ? response.body.data
      : [];

    for (const bucket of buckets) {
      const date = unixToDateKey(Number(bucket?.start_time ?? 0));
      const results: any[] = Array.isArray(bucket?.results) ? bucket.results : [];
      for (const item of results) {
        const amount = money(item?.amount?.value);
        const currency =
          typeof item?.amount?.currency === 'string'
            ? item.amount.currency
            : null;
        const lineItem =
          typeof item?.line_item === 'string' && item.line_item.length > 0
            ? item.line_item
            : null;

        points.push({
          date,
          projectId: projectIdOf(item),
          lineItem,
          model: modelFromLineItem(lineItem),
          amount,
          currency,
          quantity:
            item?.quantity === null || item?.quantity === undefined
              ? null
              : num(item?.quantity),
          quantityUnit:
            typeof item?.quantity_unit === 'string' ? item.quantity_unit : null,
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
    totals: aggregateCostTotals(points),
    byDate: aggregateCostByDate(points),
    byProject: aggregateCostByProject(points),
    byLineItem: aggregateCostByLineItem(points),
    pagination: { pages, hasMore, nextPage },
    message:
      points.length > 0
        ? `Đã đọc ${points.length} dòng chi phí từ OpenAI Organization.`
        : 'OpenAI không có dữ liệu chi phí trong khoảng thời gian này.',
  };
}

/**
 * Tổng hợp chi phí theo đơn vị tiền tệ.
 *
 * Không quy đổi giữa các đơn vị — nếu dữ liệu có nhiều đơn vị thì `amount`
 * trả về `null` để không gây hiểu nhầm.
 */
export function aggregateCostTotals(
  points: OpenAICostPoint[],
): OpenAICostTotals {
  const map = new Map<string, number>();
  for (const point of points) {
    const key = point.currency ?? 'unknown';
    map.set(key, (map.get(key) ?? 0) + point.amount);
  }

  const byCurrency = [...map.entries()].map(([currency, amount]) => ({
    currency: currency === 'unknown' ? null : currency,
    amount,
  }));

  if (byCurrency.length === 1) {
    return {
      byCurrency,
      amount: byCurrency[0].amount,
      currency: byCurrency[0].currency,
    };
  }

  return { byCurrency, amount: null, currency: null };
}

/** Gom nhóm chi phí theo ngày. */
export function aggregateCostByDate(points: OpenAICostPoint[]) {
  const map = new Map<
    string,
    { date: string; amount: number; currency: string | null }
  >();
  for (const point of points) {
    const current = map.get(point.date) ?? {
      date: point.date,
      amount: 0,
      currency: point.currency,
    };
    current.amount += point.amount;
    map.set(point.date, current);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Gom nhóm chi phí theo dự án. */
export function aggregateCostByProject(points: OpenAICostPoint[]) {
  const map = new Map<
    string,
    { projectId: string; amount: number; currency: string | null }
  >();
  for (const point of points) {
    if (!point.projectId) continue;
    const current = map.get(point.projectId) ?? {
      projectId: point.projectId,
      amount: 0,
      currency: point.currency,
    };
    current.amount += point.amount;
    map.set(point.projectId, current);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** Gom nhóm chi phí theo loại chi phí (line item). */
export function aggregateCostByLineItem(points: OpenAICostPoint[]) {
  const map = new Map<
    string,
    { lineItem: string; amount: number; currency: string | null }
  >();
  for (const point of points) {
    if (!point.lineItem) continue;
    const current = map.get(point.lineItem) ?? {
      lineItem: point.lineItem,
      amount: 0,
      currency: point.currency,
    };
    current.amount += point.amount;
    map.set(point.lineItem, current);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/**
 * Kiểm tra Admin API Key có dùng được cho dữ liệu Organization hay không.
 *
 * @param adminApiKey Admin API Key cụ thể của người dùng (đã giải mã). Nếu
 *   không có thì dùng `OPENAI_ADMIN_API_KEY` của máy chủ.
 *
 * Trả về `null` khi mọi thứ ổn, hoặc thông tin lỗi đã chuẩn hoá.
 */
export async function checkAdminKeyScope(
  adminApiKey?: string,
): Promise<OpenAIErrorInfo | null> {
  const key = adminApiKey || config.openai.adminApiKey;

  if (!key) {
    return toOpenAIError({
      status: 0,
      body: null,
      networkError: 'ADMIN_API_KEY_NOT_CONFIGURED',
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const response = await openAIRequest(USAGE_COMPLETIONS_PATH, {
    credential: 'admin',
    adminApiKeyOverride: adminApiKey,
    query: {
      start_time: now - 60,
      end_time: now,
      bucket_width: '1d',
      group_by: ['model'],
      limit: 1,
    },
  });

  if (response.status < 200 || response.status >= 300) {
    return toOpenAIError(response);
  }

  return null;
}
