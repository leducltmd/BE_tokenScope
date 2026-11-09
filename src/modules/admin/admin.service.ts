import { prisma } from '../../config/prisma';
import { NotFoundError } from '../../utils/errors';

/** Khoảng thời gian thống kê. */
export type AdminRange = 'day' | 'week' | 'month';

/** Số ngày tương ứng với từng khoảng thống kê. */
const RANGE_DAYS: Record<AdminRange, number> = {
  day: 1,
  week: 7,
  month: 30,
};

/** Số ngày dùng để xác định "người dùng đang hoạt động". */
const ACTIVE_WINDOW_DAYS = 30;

export interface AdminOverview {
  totalUsers: number;
  activeUsers: number;
  newUsersInRange: number;
  totalAppOpens: number;
  totalAppUsageEvents: number;
  totalAiApiCalls: number;
  totalTokens: number;
  totalCost: number;
  failedApiCalls: number;
  activeWindowDays: number;
  crashlyticsProjectId: string;
  generatedAt: string;
}

export interface AdminTimeSeriesPoint {
  /** Khoá nhóm theo ngày/tuần/tháng. */
  label: string;
  /** Đầu chu kỳ (ISO). */
  date: string;
  appOpens: number;
  appEvents: number;
  aiApiCalls: number;
  tokens: number;
  cost: number;
  activeUsers: number;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isVerified: boolean;
  isActive: boolean;
  isAdmin: boolean;
  role: string;
  createdAt: string;
  lastLoginAt: string | null;
  /** Số lần mở ứng dụng (toàn bộ thời gian). */
  appOpenCount: number;
  /** Số lần sử dụng ứng dụng (toàn bộ sự kiện). */
  usageCount: number;
  /** Số lượt gọi API AI. */
  aiApiCalls: number;
  totalTokens: number;
  totalCost: number;
  /** Người dùng có hoạt động trong 30 ngày gần nhất hay không. */
  isCurrentlyActive: boolean;
}

export interface AdminUserListResult {
  users: AdminUserRow[];
  total: number;
  offset: number;
  limit: number;
}

export interface AdminUserDetail extends AdminUserRow {
  birthDate: string | null;
  projectCount: number;
  providerCount: number;
  sessionCount: number;
  budgetCount: number;
  recentAppEvents: {
    id: string;
    eventName: string;
    feature: string | null;
    screen: string | null;
    occurredAt: string;
  }[];
  usageHistory: {
    id: string;
    model: string;
    provider: string;
    providerType: string;
    totalTokens: number;
    cost: number;
    isSuccess: boolean;
    statusCode: number;
    occurredAt: string;
  }[];
}

export interface AdminFeatureEvent {
  eventName: string;
  feature: string | null;
  count: number;
  lastOccurredAt: string;
}

/** Định dạng ngày theo chuẩn ISO (yyyy-MM-dd) — dùng làm khoá nhóm. */
function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Đầu chu kỳ tính theo range (day = hôm nay, week = 7 ngày, month = 30 ngày). */
function rangeStart(range: AdminRange): Date {
  const days = RANGE_DAYS[range];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

/** Định dạng nhãn biểu đồ theo range. */
function formatLabel(date: Date, range: AdminRange): string {
  const d = new Date(date);
  if (range === 'month') {
    return `${String(d.getDate()).padStart(2, '0')}/${String(
      d.getMonth() + 1,
    ).padStart(2, '0')}`;
  }
  if (range === 'week') {
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    return days[d.getDay()];
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

/** Lấy số liệu tổng quan cho Admin Dashboard. */
export async function getOverview(
  crashlyticsProjectId: string,
): Promise<AdminOverview> {
  const activeSince = new Date();
  activeSince.setDate(activeSince.getDate() - ACTIVE_WINDOW_DAYS);

  const since = rangeStart('month');

  const [
    totalUsers,
    newUsersInRange,
    activeFromUsage,
    activeFromApp,
    activeFromLogin,
    totalAppOpens,
    totalAppUsageEvents,
    totalAiApiCalls,
    failedApiCalls,
    tokenAgg,
    costAgg,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.usageRecord.findMany({
      where: { occurredAt: { gte: activeSince } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.appUsageEvent.findMany({
      where: { occurredAt: { gte: activeSince }, userId: { not: null } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.user.findMany({
      where: { lastLoginAt: { gte: activeSince } },
      select: { id: true },
    }),
    prisma.appUsageEvent.count({ where: { eventName: 'app_open' } }),
    prisma.appUsageEvent.count(),
    prisma.usageRecord.count(),
    prisma.usageRecord.count({ where: { isSuccess: false } }),
    prisma.usageRecord.aggregate({ _sum: { totalTokens: true } }),
    prisma.usageRecord.aggregate({ _sum: { cost: true } }),
  ]);

  // Người dùng "đang hoạt động" = có hoạt động trong 30 ngày gần nhất,
  // tính từ cả 3 nguồn: lượt gọi API AI, sự kiện trong app, và đăng nhập.
  const activeIds = new Set<string>();
  for (const row of activeFromUsage) if (row.userId) activeIds.add(row.userId);
  for (const row of activeFromApp) if (row.userId) activeIds.add(row.userId);
  for (const row of activeFromLogin) activeIds.add(row.id);

  return {
    totalUsers,
    activeUsers: activeIds.size,
    newUsersInRange,
    totalAppOpens,
    totalAppUsageEvents,
    totalAiApiCalls,
    totalTokens: tokenAgg._sum.totalTokens ?? 0,
    totalCost: Number(costAgg._sum.cost ?? 0),
    failedApiCalls,
    activeWindowDays: ACTIVE_WINDOW_DAYS,
    crashlyticsProjectId,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Chuỗi thời gian thống kê lượt sử dụng theo ngày / tuần / tháng.
 *
 * Trả về đúng số điểm tương ứng với khoảng đã chọn (kể cả những ngày không
 * có dữ liệu) để biểu đồ không bị "lệch" so với trục thời gian.
 */
export async function getTimeSeries(
  range: AdminRange,
): Promise<AdminTimeSeriesPoint[]> {
  const days = RANGE_DAYS[range];
  const start = rangeStart(range);

  // Với range = day, gom theo giờ; còn lại gom theo ngày.
  const bucketMs = range === 'day' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const bucketCount = range === 'day' ? 24 : days;

  const [appEvents, usageRecords] = await Promise.all([
    prisma.appUsageEvent.findMany({
      where: { occurredAt: { gte: start } },
      select: {
        eventName: true,
        userId: true,
        occurredAt: true,
      },
    }),
    prisma.usageRecord.findMany({
      where: { occurredAt: { gte: start } },
      select: {
        userId: true,
        totalTokens: true,
        cost: true,
        occurredAt: true,
      },
    }),
  ]);

  const buckets = new Map<
    number,
    AdminTimeSeriesPoint & { users: Set<string> }
  >();

  const ensureBucket = (timestamp: number): AdminTimeSeriesPoint & {
    users: Set<string>;
  } => {
    const bucketIndex = Math.floor((timestamp - start.getTime()) / bucketMs);
    const key = start.getTime() + bucketIndex * bucketMs;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        date: new Date(key).toISOString(),
        label: formatLabel(new Date(key), range),
        appOpens: 0,
        appEvents: 0,
        aiApiCalls: 0,
        tokens: 0,
        cost: 0,
        activeUsers: 0,
        users: new Set<string>(),
      };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  for (const event of appEvents) {
    const bucket = ensureBucket(event.occurredAt.getTime());
    bucket.appEvents += 1;
    if (event.eventName === 'app_open') bucket.appOpens += 1;
    if (event.userId) bucket.users.add(event.userId);
  }

  for (const record of usageRecords) {
    const bucket = ensureBucket(record.occurredAt.getTime());
    bucket.aiApiCalls += 1;
    bucket.tokens += record.totalTokens;
    bucket.cost += Number(record.cost ?? 0);
    if (record.userId) bucket.users.add(record.userId);
  }

  const points = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Bổ sung các bucket trống còn thiếu để trục thời gian liên tục.
  const filled: AdminTimeSeriesPoint[] = [];
  for (let i = 0; i < bucketCount; i += 1) {
    const key = start.getTime() + i * bucketMs;
    const bucket = buckets.get(key);
    if (bucket) {
      filled.push({
        ...bucket,
        activeUsers: bucket.users.size,
      });
    } else {
      filled.push({
        date: new Date(key).toISOString(),
        label: formatLabel(new Date(key), range),
        appOpens: 0,
        appEvents: 0,
        aiApiCalls: 0,
        tokens: 0,
        cost: 0,
        activeUsers: 0,
      });
    }
  }

  return filled;
}

/** Thống kê số lượt sử dụng theo tên sự kiện / tính năng. */
export async function getFeatureEvents(
  days = 30,
): Promise<AdminFeatureEvent[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await prisma.appUsageEvent.groupBy({
    by: ['eventName', 'feature'],
    where: { occurredAt: { gte: since } },
    _count: { _all: true },
    _max: { occurredAt: true },
  });

  return rows
    .map((row) => ({
      eventName: row.eventName,
      feature: row.feature,
      count: row._count._all,
      lastOccurredAt: (row._max.occurredAt ?? since).toISOString(),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Danh sách người dùng kèm số liệu sử dụng (có tìm kiếm & phân trang). */
export async function listUsers(
  query: {
    search?: string;
    status?: 'all' | 'active' | 'inactive';
    offset: number;
    limit: number;
  },
): Promise<AdminUserListResult> {
  const where: Record<string, unknown> = {};

  if (query.search) {
    where.OR = [
      { name: { contains: query.search } },
      { email: { contains: query.search } },
      { id: { contains: query.search } },
    ];
  }

  if (query.status === 'active') {
    where.isActive = true;
  } else if (query.status === 'inactive') {
    where.isActive = false;
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: query.offset,
      take: query.limit,
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        isVerified: true,
        isActive: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
      },
    }),
  ]);

  const rows = await attachUsageStats(users);

  return { users: rows, total, offset: query.offset, limit: query.limit };
}

/** Gắn số liệu sử dụng (app usage + lượt gọi API AI) cho từng người dùng. */
async function attachUsageStats(
  users: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    isVerified: boolean;
    isActive: boolean;
    role: string;
    createdAt: Date;
    lastLoginAt: Date | null;
  }[],
): Promise<AdminUserRow[]> {
  if (users.length === 0) return [];

  const ids = users.map((u) => u.id);
  const activeSince = new Date();
  activeSince.setDate(activeSince.getDate() - ACTIVE_WINDOW_DAYS);

  const [openCounts, eventCounts, usageCounts, tokenAggs, costAggs, activeIds] =
    await Promise.all([
      prisma.appUsageEvent.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, eventName: 'app_open' },
        _count: { _all: true },
      }),
      prisma.appUsageEvent.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.usageRecord.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.usageRecord.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _sum: { totalTokens: true },
      }),
      prisma.usageRecord.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _sum: { cost: true },
      }),
      prisma.appUsageEvent.findMany({
        where: {
          userId: { in: ids },
          occurredAt: { gte: activeSince },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

  const mapOf = <T extends { userId: string | null }>(rows: T[]) => {
    const map = new Map<string, T>();
    for (const row of rows) {
      if (row.userId) map.set(row.userId, row);
    }
    return map;
  };

  const openMap = mapOf(openCounts);
  const eventMap = mapOf(eventCounts);
  const usageMap = mapOf(usageCounts);
  const tokenMap = mapOf(tokenAggs);
  const costMap = mapOf(costAggs);
  const activeSet = new Set(
    activeIds.map((r) => r.userId).filter((v): v is string => Boolean(v)),
  );

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    isVerified: user.isVerified,
    isActive: user.isActive,
    isAdmin: user.role === 'admin',
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    appOpenCount: openMap.get(user.id)?._count._all ?? 0,
    usageCount: eventMap.get(user.id)?._count._all ?? 0,
    aiApiCalls: usageMap.get(user.id)?._count._all ?? 0,
    totalTokens: tokenMap.get(user.id)?._sum.totalTokens ?? 0,
    totalCost: Number(costMap.get(user.id)?._sum.cost ?? 0),
    isCurrentlyActive: activeSet.has(user.id),
  }));
}

/** Chi tiết đầy đủ của một người dùng + lịch sử sử dụng. */
export async function getUserDetail(
  userId: string,
  limit = 50,
): Promise<AdminUserDetail> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      isVerified: true,
      isActive: true,
      role: true,
      birthDate: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!user) {
    throw new NotFoundError('Không tìm thấy người dùng.');
  }

  const [rows] = await attachUsageStats([user]);

  const [projectCount, providerCount, sessionCount, budgetCount, appEvents, usageRecords] =
    await Promise.all([
      prisma.project.count({ where: { userId } }),
      prisma.apiProvider.count({ where: { userId } }),
      prisma.session.count({ where: { userId } }),
      prisma.budget.count({ where: { userId } }),
      prisma.appUsageEvent.findMany({
        where: { userId },
        orderBy: { occurredAt: 'desc' },
        take: 50,
        select: {
          id: true,
          eventName: true,
          feature: true,
          screen: true,
          occurredAt: true,
        },
      }),
      prisma.usageRecord.findMany({
        where: { userId },
        orderBy: { occurredAt: 'desc' },
        take: limit,
        include: {
          apiProvider: { select: { providerType: true, name: true } },
        },
      }),
    ]);

  return {
    ...rows,
    birthDate: user.birthDate?.toISOString() ?? null,
    projectCount,
    providerCount,
    sessionCount,
    budgetCount,
    recentAppEvents: appEvents.map((event) => ({
      id: event.id,
      eventName: event.eventName,
      feature: event.feature,
      screen: event.screen,
      occurredAt: event.occurredAt.toISOString(),
    })),
    usageHistory: usageRecords.map((record) => ({
      id: record.id,
      model: record.model,
      provider: record.apiProvider.name,
      providerType: record.apiProvider.providerType,
      totalTokens: record.totalTokens,
      cost: Number(record.cost ?? 0),
      isSuccess: record.isSuccess,
      statusCode: record.statusCode,
      occurredAt: record.occurredAt.toISOString(),
    })),
  };
}

/**
 * Thống kê theo ngày của một người dùng — dùng cho biểu đồ chi tiết.
 */
export async function getUserDailyUsage(
  userId: string,
  days = 14,
): Promise<{ date: string; appOpens: number; aiApiCalls: number; tokens: number }[]> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const [appEvents, usageRecords] = await Promise.all([
    prisma.appUsageEvent.findMany({
      where: { userId, occurredAt: { gte: since } },
      select: { eventName: true, occurredAt: true },
    }),
    prisma.usageRecord.findMany({
      where: { userId, occurredAt: { gte: since } },
      select: { totalTokens: true, occurredAt: true },
    }),
  ]);

  const map = new Map<
    string,
    { date: string; appOpens: number; aiApiCalls: number; tokens: number }
  >();

  for (let i = 0; i < days; i += 1) {
    const date = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    map.set(dateKey(date), {
      date: dateKey(date),
      appOpens: 0,
      aiApiCalls: 0,
      tokens: 0,
    });
  }

  for (const event of appEvents) {
    if (event.eventName !== 'app_open') continue;
    const key = dateKey(event.occurredAt);
    const point = map.get(key);
    if (point) point.appOpens += 1;
  }

  for (const record of usageRecords) {
    const key = dateKey(record.occurredAt);
    const point = map.get(key);
    if (!point) continue;
    point.aiApiCalls += 1;
    point.tokens += record.totalTokens;
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
