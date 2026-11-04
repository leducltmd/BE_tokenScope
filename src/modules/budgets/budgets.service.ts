import { prisma } from '../../config/prisma';
import { findProviderDefinition } from '../providers/providers.catalog';

/** Một hạn mức chi phí theo nhà cung cấp. */
export interface BudgetProviderView {
  providerType: string;
  name: string;
  models: string;
  spent: number;
  limit: number;
}

/** Một hạn mức chi phí theo dự án. */
export interface BudgetProjectView {
  id: string;
  name: string;
  models: string;
  spent: number;
  limit: number;
}

export interface BudgetOverview {
  /** Chu kỳ tính toán hiện tại. */
  period: { start: Date; end: Date; label: string };
  /** Hạn mức tổng (USD). */
  totalLimit: number;
  /** Ngưỡng cảnh báo (USD). */
  threshold: number;
  /** Chi phí đã dùng trong chu kỳ (USD). */
  spent: number;
  /** Phần trăm đã dùng so với hạn mức tổng. */
  percent: number;
  /** Phần trăm ngưỡng cảnh báo đã đạt. */
  thresholdPercent: number;
  providers: BudgetProviderView[];
  projects: BudgetProjectView[];
  /** Dự báo chi tiêu cuối chu kỳ dựa trên tốc độ hiện tại. */
  forecast: number;
}

/** Đầu tháng hiện tại. */
function startOfMonth(reference: Date): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), 1);
}

/** Cuối tháng hiện tại (23:59:59.999). */
function endOfMonth(reference: Date): Date {
  return new Date(
    reference.getFullYear(),
    reference.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
}

/** Nhãn chu kỳ — `01/11 - 30/11`. */
function periodLabel(start: Date, end: Date): string {
  const dd = (d: Date) => `${d.getDate()}`.padStart(2, '0');
  const mm = (d: Date) => `${d.getMonth() + 1}`.padStart(2, '0');
  return `${dd(start)}/${mm(start)} - ${dd(end)}/${mm(end)}`;
}

/**
 * Lấy toàn bộ số liệu ngân sách thật của người dùng trong tháng hiện tại.
 *
 * - `spent` được tính từ bảng `usage_records` (chi phí thật đã ghi nhận).
 * - `limit` lấy từ bảng `budgets` (hạn mức do người dùng đặt).
 */
export async function getBudgetOverview(
  userId: string,
): Promise<BudgetOverview> {
  const now = new Date();
  const budgets = await prisma.budget.findMany({
    where: { userId },
    include: { apiProvider: { select: { providerType: true, name: true } } },
  });

  // Chu kỳ tính toán lấy từ bảng `budgets`; nếu chưa có thì dùng tháng hiện tại.
  const periodStart = budgets.length
    ? budgets.reduce(
        (min, b) => (b.periodStart < min ? b.periodStart : min),
        budgets[0].periodStart,
      )
    : startOfMonth(now);
  const periodEnd = budgets.length
    ? budgets.reduce(
        (max, b) => (b.periodEnd > max ? b.periodEnd : max),
        budgets[0].periodEnd,
      )
    : endOfMonth(now);

  const [providerUsage, projectUsage, totalSpend] = await Promise.all([
    prisma.usageRecord.groupBy({
      by: ['apiProviderId', 'model'],
      where: {
        userId,
        occurredAt: { gte: periodStart, lte: periodEnd },
      },
      _sum: { cost: true, totalTokens: true },
    }),
    prisma.usageRecord.groupBy({
      by: ['projectId', 'model'],
      where: {
        userId,
        occurredAt: { gte: periodStart, lte: periodEnd },
      },
      _sum: { cost: true },
    }),
    prisma.usageRecord.aggregate({
      where: {
        userId,
        occurredAt: { gte: periodStart, lte: periodEnd },
      },
      _sum: { cost: true },
    }),
  ]);

  const spent = Number(totalSpend._sum.cost ?? 0);

  // ── Theo nhà cung cấp ───────────────────────────────────────────────
  const providerSpend = new Map<string, { cost: number; models: Set<string> }>();
  const providerTypes = new Map<string, string>();
  const providerNames = new Map<string, string>();

  for (const row of providerUsage) {
    const key = row.apiProviderId;
    const current = providerSpend.get(key) ?? {
      cost: 0,
      models: new Set<string>(),
    };
    current.cost += Number(row._sum.cost ?? 0);
    if (row.model) current.models.add(row.model);
    providerSpend.set(key, current);
  }

  for (const budget of budgets) {
    const providerId = budget.apiProviderId;
    if (!providerId || !budget.apiProvider) continue;
    providerTypes.set(providerId, budget.apiProvider.providerType);
    providerNames.set(providerId, budget.apiProvider.name);
  }

  const providers: BudgetProviderView[] = budgets
    .filter((budget) => budget.apiProviderId !== null)
    .map((budget) => {
      const providerId = budget.apiProviderId as string;
      const usage = providerSpend.get(providerId);
      const definition = findProviderDefinition(providerTypes.get(providerId) ?? '');
      return {
        providerType: providerTypes.get(providerId) ?? '',
        name:
          providerNames.get(providerId) ??
          definition?.name ??
          'Nhà cung cấp',
        models:
          usage && usage.models.size > 0
            ? [...usage.models].slice(0, 3).join(', ')
            : (definition?.name ?? ''),
        spent: Number(usage?.cost ?? 0),
        limit: Number(budget.monthlyLimit ?? 0),
      };
    });

  // ── Theo dự án ──────────────────────────────────────────────────────
  const projectIds = [
    ...new Set(
      projectUsage
        .map((row) => row.projectId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const projects = projectIds.length
    ? await prisma.project.findMany({ where: { id: { in: projectIds } } })
    : [];

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const projectLimits = new Map<string, number>();
  for (const budget of budgets) {
    if (budget.apiProviderId === null && budget.projectId) {
      projectLimits.set(
        budget.projectId,
        (projectLimits.get(budget.projectId) ?? 0) +
          Number(budget.monthlyLimit ?? 0),
      );
    }
  }

  // Gom model theo từng dự án.
  const projectModels = new Map<string, Set<string>>();
  for (const row of projectUsage) {
    if (!row.projectId || !row.model) continue;
    const set = projectModels.get(row.projectId) ?? new Set<string>();
    set.add(row.model);
    projectModels.set(row.projectId, set);
  }

  const projectSpend = new Map<string, number>();
  for (const row of projectUsage) {
    if (!row.projectId) continue;
    projectSpend.set(
      row.projectId,
      (projectSpend.get(row.projectId) ?? 0) + Number(row._sum.cost ?? 0),
    );
  }

  const projectViews: BudgetProjectView[] = projectIds.map((projectId) => {
    const project = projectById.get(projectId);
    const models = [...(projectModels.get(projectId) ?? [])];
    return {
      id: projectId,
      name: project?.name ?? 'Dự án',
      models: models.slice(0, 3).join(', '),
      spent: Number((projectSpend.get(projectId) ?? 0).toFixed(6)),
      limit: projectLimits.get(projectId) ?? 0,
    };
  });

  const totalLimit = budgets.reduce(
    (sum, budget) => sum + Number(budget.monthlyLimit ?? 0),
    0,
  );

  // Ngưỡng cảnh báo lấy theo `warningPercent` đã cấu hình; mặc định 80%.
  const warningPercent = budgets.length
    ? Math.min(...budgets.map((b) => b.warningPercent))
    : 80;
  const threshold = totalLimit > 0 ? (totalLimit * warningPercent) / 100 : 0;

  // Dự báo: chi phí tính theo tốc độ trung bình từ đầu chu kỳ tới thời điểm hiện tại.
  const msPerDay = 24 * 60 * 60 * 1000;
  const periodDays = Math.max(
    1,
    Math.round((periodEnd.getTime() - periodStart.getTime()) / msPerDay),
  );
  const elapsedDays = Math.min(
    periodDays,
    Math.max(
      1,
      Math.floor((now.getTime() - periodStart.getTime()) / msPerDay) + 1,
    ),
  );
  const forecast = Number(((spent / elapsedDays) * periodDays).toFixed(2));

  return {
    period: {
      start: periodStart,
      end: periodEnd,
      label: periodLabel(periodStart, periodEnd),
    },
    totalLimit,
    threshold,
    spent,
    percent: totalLimit > 0 ? Number(((spent / totalLimit) * 100).toFixed(2)) : 0,
    thresholdPercent:
      threshold > 0 ? Number(((spent / threshold) * 100).toFixed(2)) : 0,
    providers,
    projects: projectViews,
    forecast,
  };
}
