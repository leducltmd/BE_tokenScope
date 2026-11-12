import { prisma } from '../../config/prisma';
import { NotFoundError } from '../../utils/errors';
import { findProviderDefinition } from '../providers/providers.catalog';
import { importGeminiDemoCall } from './gemini-call-import';
import type { UsageQueryDto } from './usage.validation';

/** Một bản ghi usage trả về cho client. */
export interface UsageRecordView {
  id: string;
  promptId: string;
  provider: string;
  providerType: string;
  model: string;
  project: string;
  projectIconType: string;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  currency: string;
  latencyMs: number | null;
  statusCode: number;
  statusMessage: string;
  isSuccess: boolean;
  errorMessage: string | null;
  promptPreview: string;
  responsePreview: string;
  apiEndpoint: string | null;
}

export interface UsageListResult {
  records: UsageRecordView[];
  total: number;
  offset: number;
  limit: number;
}

/** Tên hiển thị của nhà cung cấp theo mã. */
function providerName(providerType: string): string {
  return findProviderDefinition(providerType)?.name ?? providerType;
}

/** Biểu tượng gợi ý cho dự án dựa trên tên dự án. */
function projectIconType(projectName: string): string {
  const value = projectName.toLowerCase();
  if (value.includes('code') || value.includes('backend')) return 'code';
  if (value.includes('content') || value.includes('generator')) return 'edit';
  if (value.includes('search') || value.includes('rag')) return 'search';
  if (value.includes('agent') || value.includes('bot')) return 'robot';
  return 'folder';
}

/** Mô tả trạng thái theo mã HTTP trả về. */
function statusMessage(statusCode: number, isSuccess: boolean): string {
  if (isSuccess) return `Thành công (${statusCode} OK)`;
  if (statusCode === 429) return 'Lỗi Rate Limit (429)';
  if (statusCode === 401) return 'Lỗi xác thực (401 Unauthorized)';
  if (statusCode === 403) return 'Lỗi phân quyền (403 Forbidden)';
  if (statusCode >= 500) return `Lỗi máy chủ (${statusCode} Internal Error)`;
  return `Lỗi (${statusCode})`;
}

/** Chuyển bản ghi DB sang dạng trả về cho client. */
function toView(record: {
  id: string;
  model: string;
  endpoint: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: unknown;
  latencyMs: number | null;
  statusCode: number;
  isSuccess: boolean;
  occurredAt: Date;
  apiProvider: { providerType: string; name: string };
  project: { name: string } | null;
}): UsageRecordView {
  const projectName = record.project?.name ?? record.apiProvider.name;

  return {
    id: record.id,
    promptId: record.id.slice(0, 12),
    provider: providerName(record.apiProvider.providerType),
    providerType: record.apiProvider.providerType,
    model: record.model,
    project: projectName,
    projectIconType: projectIconType(projectName),
    timestamp: record.occurredAt.toISOString(),
    inputTokens: record.promptTokens,
    outputTokens: record.completionTokens,
    totalTokens: record.totalTokens,
    cost: Number(record.cost ?? 0),
    currency: 'USD',
    latencyMs: record.latencyMs,
    statusCode: record.statusCode,
    statusMessage: statusMessage(record.statusCode, record.isSuccess),
    isSuccess: record.isSuccess,
    errorMessage: record.isSuccess
      ? null
      : `Yêu cầu thất bại với mã ${record.statusCode}.`,
    promptPreview: `${record.model} · ${record.promptTokens} token đầu vào`,
    responsePreview: `${record.completionTokens} token đầu ra · $${Number(
      record.cost ?? 0,
    ).toFixed(6)}`,
    apiEndpoint: record.endpoint,
  };
}

/** Lấy danh sách bản ghi usage kèm phân trang và bộ lọc. */
export async function listUsageRecords(
  userId: string,
  query: UsageQueryDto,
): Promise<UsageListResult> {
  await importGeminiDemoCall(userId);
  const where: Record<string, unknown> = { userId };

  if (query.providerId) {
    where.apiProviderId = query.providerId;
  }
  if (query.providerType) {
    where.apiProvider = { providerType: query.providerType };
  }
  if (query.from || query.to) {
    where.occurredAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }
  if (query.search) {
    where.OR = [
      { model: { contains: query.search } },
      { endpoint: { contains: query.search } },
      { apiProvider: { name: { contains: query.search } } },
      { project: { name: { contains: query.search } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.usageRecord.count({ where }),
    prisma.usageRecord.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: query.offset,
      take: query.limit,
      include: {
        apiProvider: { select: { providerType: true, name: true } },
        project: { select: { name: true } },
      },
    }),
  ]);

  return {
    records: rows.map(toView),
    total,
    offset: query.offset,
    limit: query.limit,
  };
}

/** Tổng hợp số liệu cho Dashboard / Providers. */
export async function getUsageSummary(userId: string): Promise<{
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  requestCount: number;
  byProvider: {
    providerType: string;
    provider: string;
    totalTokens: number;
    totalCost: number;
    requestCount: number;
  }[];
  daily: { date: string; totalTokens: number; totalCost: number }[];
}> {
  await importGeminiDemoCall(userId);
  const records = await prisma.usageRecord.findMany({
    where: { userId },
    orderBy: { occurredAt: 'desc' },
    take: 5000,
    select: {
      totalTokens: true,
      promptTokens: true,
      completionTokens: true,
      cost: true,
      occurredAt: true,
      apiProvider: { select: { providerType: true } },
    },
  });

  const byProviderMap = new Map<
    string,
    { totalTokens: number; totalCost: number; requestCount: number }
  >();
  const dailyMap = new Map<
    string,
    { totalTokens: number; totalCost: number }
  >();

  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCost = 0;

  for (const record of records) {
    const tokens = record.totalTokens;
    const cost = Number(record.cost ?? 0);
    totalTokens += tokens;
    inputTokens += record.promptTokens;
    outputTokens += record.completionTokens;
    totalCost += cost;

    const type = record.apiProvider.providerType;
    const current = byProviderMap.get(type) ?? {
      totalTokens: 0,
      totalCost: 0,
      requestCount: 0,
    };
    current.totalTokens += tokens;
    current.totalCost += cost;
    current.requestCount += 1;
    byProviderMap.set(type, current);

    const dateKey = record.occurredAt.toISOString().slice(0, 10);
    const daily = dailyMap.get(dateKey) ?? { totalTokens: 0, totalCost: 0 };
    daily.totalTokens += tokens;
    daily.totalCost += cost;
    dailyMap.set(dateKey, daily);
  }

  return {
    totalTokens,
    inputTokens,
    outputTokens,
    totalCost,
    requestCount: records.length,
    byProvider: [...byProviderMap.entries()].map(([providerType, value]) => ({
      providerType,
      provider: providerName(providerType),
      ...value,
    })),
    daily: [...dailyMap.entries()]
      .map(([date, value]) => ({ date, ...value }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Lấy chi tiết một bản ghi usage. */
export async function getUsageRecord(
  userId: string,
  id: string,
): Promise<UsageRecordView> {
  const record = await prisma.usageRecord.findFirst({
    where: { id, userId },
    include: {
      apiProvider: { select: { providerType: true, name: true } },
      project: { select: { name: true } },
    },  });
  if (!record) {
    throw new NotFoundError('Không tìm thấy bản ghi sử dụng.');
  }
  return toView(record);
}

/** Số liệu phân tích chi tiết cho màn hình "Phân tích sử dụng AI". */
export interface UsageAnalysis {
  totalTokens: number;
  totalCost: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  /** Tỷ lệ đầu vào / đầu ra. */
  inputRatio: number;
  outputRatio: number;
  /** Chuỗi 7 ngày gần nhất — ngày, token, chi phí. */
  weekly: { date: string; totalTokens: number; totalCost: number }[];
  /** Điểm đỉnh trong tuần. */
  peak: { date: string; totalTokens: number; totalCost: number } | null;
  /** Trung bình token mỗi ngày. */
  dailyAverage: number;
  byProvider: {
    providerType: string;
    provider: string;
    totalTokens: number;
    totalCost: number;
    requestCount: number;
  }[];
  /** Mô hình dùng nhiều nhất. */
  byModel: {
    model: string;
    provider: string;
    providerType: string;
    totalTokens: number;
    totalCost: number;
    requestCount: number;
  }[];
}

/**
 * Tổng hợp số liệu phân tích từ bảng `usage_records`.
 *
 * @param days Số ngày gần nhất cần phân tích (mặc định 7).
 */
export async function getUsageAnalysis(
  userId: string,
  days = 7,
): Promise<UsageAnalysis> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const records = await prisma.usageRecord.findMany({
    where: { userId, occurredAt: { gte: since } },
    orderBy: { occurredAt: 'asc' },
    include: {
      apiProvider: { select: { providerType: true, name: true } },
    },
  });

  let totalTokens = 0;
  let totalCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const dailyMap = new Map<string, { totalTokens: number; totalCost: number }>();
  const providerMap = new Map<
    string,
    { totalTokens: number; totalCost: number; requestCount: number }
  >();
  const modelMap = new Map<
    string,
    { totalTokens: number; totalCost: number; requestCount: number }
  >();

  for (const record of records) {
    totalTokens += record.totalTokens;
    totalCost += Number(record.cost ?? 0);
    inputTokens += record.promptTokens;
    outputTokens += record.completionTokens;

    const dateKey = record.occurredAt.toISOString().slice(0, 10);
    const daily = dailyMap.get(dateKey) ?? { totalTokens: 0, totalCost: 0 };
    daily.totalTokens += record.totalTokens;
    daily.totalCost += Number(record.cost ?? 0);
    dailyMap.set(dateKey, daily);

    const providerType = record.apiProvider.providerType;
    const provider = providerMap.get(providerType) ?? {
      totalTokens: 0,
      totalCost: 0,
      requestCount: 0,
    };
    provider.totalTokens += record.totalTokens;
    provider.totalCost += Number(record.cost ?? 0);
    provider.requestCount += 1;
    providerMap.set(providerType, provider);

    const modelKey = `${providerType}:${record.model}`;
    const model = modelMap.get(modelKey) ?? {
      totalTokens: 0,
      totalCost: 0,
      requestCount: 0,
    };
    model.totalTokens += record.totalTokens;
    model.totalCost += Number(record.cost ?? 0);
    model.requestCount += 1;
    modelMap.set(modelKey, model);
  }

  const weekly = [...dailyMap.entries()]
    .map(([date, value]) => ({ date, ...value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const peak = weekly.reduce<(typeof weekly)[number] | null>(
    (best, point) =>
      best === null || point.totalTokens > best.totalTokens ? point : best,
    null,
  );

  const tokenSum = inputTokens + outputTokens;

  const byModel = [...modelMap.entries()]
    .map(([key, value]) => {
      const [providerType, model] = key.split(':');
      return {
        model,
        providerType,
        provider: providerName(providerType),
        ...value,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    totalTokens,
    totalCost,
    requestCount: records.length,
    inputTokens,
    outputTokens,
    inputRatio: tokenSum > 0 ? inputTokens / tokenSum : 0,
    outputRatio: tokenSum > 0 ? outputTokens / tokenSum : 0,
    weekly,
    peak,
    dailyAverage:
      weekly.length > 0
        ? Math.round(
            weekly.reduce((sum, p) => sum + p.totalTokens, 0) / weekly.length,
          )
        : 0,
    byProvider: [...providerMap.entries()].map(([providerType, value]) => ({
      providerType,
      provider: providerName(providerType),
      ...value,
    })),
    byModel,
  };
}
