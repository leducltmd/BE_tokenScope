import { prisma } from '../../config/prisma';
import { NotFoundError } from '../../utils/errors';

/** Một dự án kèm số liệu usage thật từ bảng `usage_records`. */
export interface ProjectView {
  id: string;
  name: string;
  description: string | null;
  color: string;
  environment: string;
  createdAt: Date;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
  /** Hạn mức ngân sách của dự án (nếu có). */
  monthlyLimit: number | null;
  /** Chi phí đã dùng so với hạn mức — phần trăm. */
  budgetPercent: number;
  /** Phần trăm token của dự án so với toàn hệ thống. */
  systemSharePercent: number;
  /** Các mô hình AI đã dùng trong dự án. */
  models: { provider: string; model: string; totalTokens: number }[];
}

export interface ProjectsOverview {
  projects: ProjectView[];
  totals: {
    projectCount: number;
    totalTokens: number;
    totalCost: number;
    requestCount: number;
  };
}

/** Lấy danh sách dự án kèm số liệu usage & ngân sách thật. */
export async function listProjects(userId: string): Promise<ProjectsOverview> {
  const [projects, totalTokens, totalCost] = await Promise.all([
    prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        usageRecords: {
          select: {
            totalTokens: true,
            cost: true,
            model: true,
            apiProvider: { select: { providerType: true, name: true } },
          },
        },
        apiProviders: {
          select: { id: true },
        },
        budgets: {
          select: {
            monthlyLimit: true,
            currentSpend: true,
          },
        },
      },
    }),
    prisma.usageRecord.aggregate({
      where: { userId },
      _sum: { totalTokens: true },
    }),
    prisma.usageRecord.aggregate({
      where: { userId },
      _sum: { cost: true },
    }),
  ]);

  const systemTokens = totalTokens._sum.totalTokens ?? 0;

  const views: ProjectView[] = projects.map((project) => {
    const tokens = project.usageRecords.reduce(
      (sum, record) => sum + record.totalTokens,
      0,
    );
    const cost = project.usageRecords.reduce(
      (sum, record) => sum + Number(record.cost),
      0,
    );

    // Gom model theo nhà cung cấp.
    const modelMap = new Map<
      string,
      { provider: string; model: string; totalTokens: number }
    >();
    for (const record of project.usageRecords) {
      const key = `${record.apiProvider.providerType}:${record.model}`;
      const current = modelMap.get(key) ?? {
        provider: record.apiProvider.name,
        model: record.model,
        totalTokens: 0,
      };
      current.totalTokens += record.totalTokens;
      modelMap.set(key, current);
    }

    const models = [...modelMap.values()].sort(
      (a, b) => b.totalTokens - a.totalTokens,
    );

    const monthlyLimit = project.budgets.reduce(
      (sum, budget) => sum + Number(budget.monthlyLimit),
      0,
    );

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      environment: project.environment,
      createdAt: project.createdAt,
      totalTokens: tokens,
      totalCost: cost,
      requestCount: project.usageRecords.length,
      monthlyLimit: monthlyLimit > 0 ? monthlyLimit : null,
      budgetPercent:
        monthlyLimit > 0
          ? Number(((cost / monthlyLimit) * 100).toFixed(2))
          : 0,
      systemSharePercent:
        systemTokens > 0 ? Number(((tokens / systemTokens) * 100).toFixed(2)) : 0,
      models,
    };
  });

  return {
    projects: views,
    totals: {
      projectCount: views.length,
      totalTokens: totalTokens._sum.totalTokens ?? 0,
      totalCost: Number(totalCost._sum.cost ?? 0),
      requestCount: views.reduce((sum, p) => sum + p.requestCount, 0),
    },
  };
}

/** Lấy chi tiết một dự án. */
export async function getProject(
  userId: string,
  projectId: string,
): Promise<ProjectView> {
  const overview = await listProjects(userId);
  const found = overview.projects.find((p) => p.id === projectId);
  if (!found) {
    throw new NotFoundError('Không tìm thấy dự án.');
  }
  return found;
}
