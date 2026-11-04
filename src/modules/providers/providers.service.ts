import { prisma } from '../../config/prisma';
import { AppError, ConflictError, NotFoundError } from '../../utils/errors';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import { maskKeyLast4 } from '../../utils/helpers';
import {
  checkProviderConnection,
  fetchProviderUsage,
  type ConnectionCheckResult,
} from './providers.client';
import { assertOrgAccess } from './openai.org.service';
import {
  findProviderDefinition,
  PROVIDER_CATALOG,
  type ProviderDefinition,
} from './providers.catalog';

/** Dữ liệu nhà cung cấp trả về cho client (không chứa API key gốc). */
export interface ProviderView {
  id: string;
  name: string;
  providerType: string;
  providerName: string;
  letter: string;
  /** API key đã che — `••••••••abcd`. */
  maskedApiKey: string | null;
  /**
   * Admin API Key đã che (có với OpenAI và Anthropic) — `••••••••abcd`.
   * `null` nghĩa là người dùng chưa cung cấp khoá quản trị tổ chức.
   */
  maskedAdminApiKey: string | null;
  /**
   * Workspace ID của Anthropic đã che — `••••••••abcd`.
   * `null` nghĩa là chưa cấu hình Workspace ID.
   */
  maskedWorkspaceId: string | null;
  status: string;
  lastCheckStatus: string | null;
  lastCheckedAt: Date | null;
  usageAvailable: boolean;
  models: string[];
  createdAt: Date;
  /** Tổng token đã dùng (từ bảng usage_records). */
  totalTokens: number;
  /** Tổng chi phí đã dùng. */
  totalCost: number;
  /** Số lượt gọi. */
  requestCount: number;
  /** Thời điểm đồng bộ usage gần nhất. */
  lastSyncedAt: Date | null;
  /**
   * Trạng thái Secret API Key của Anthropic (kiểm tra độc lập).
   * `null` với các nhà cung cấp khác.
   */
  secretKeyStatus: string | null;
  /**
   * Trạng thái Admin API Key của Anthropic (kiểm tra độc lập).
   * `null` với các nhà cung cấp khác.
   */
  adminKeyStatus: string | null;
}

/** Tổng quan toàn hệ thống cho màn hình "Nhà cung cấp AI". */
export interface ProvidersOverview {
  providers: ProviderView[];
  totals: {
    providerCount: number;
    connectedCount: number;
    totalTokens: number;
    totalCost: number;
    requestCount: number;
    /** Tổng hạn mức ngân sách đang áp dụng cho các nhà cung cấp (USD). */
    totalLimit: number;
  };
}

/** Chuẩn hoá danh sách model lưu trong DB. */
function parseModels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((m) => String(m)) : [];
  } catch {
    return [];
  }
}

/** Lấy định nghĩa nhà cung cấp theo mã, có fallback cho dữ liệu cũ. */
function resolveDefinition(providerType: string): ProviderDefinition {
  const found = findProviderDefinition(providerType);
  if (found) return found;
  return {
    id: providerType,
    name: providerType,
    letter: providerType.slice(0, 1).toUpperCase(),
    baseUrl: '',
    apiKeyUrl: '',
    keyHint: '',
    supportsUsage: false,
    usageNote: 'Nhà cung cấp chưa được hỗ trợ đồng bộ usage.',
  };
}

/** Danh sách nhà cung cấp hỗ trợ kết nối (catalog tĩnh). */
export function listProviderCatalog(): ProviderDefinition[] {
  return PROVIDER_CATALOG;
}

/**
 * Kiểm tra API Key với nhà cung cấp thật.
 *
 * Không lưu gì vào database — dùng cho nút "Kiểm tra kết nối".
 */
export async function testConnection(
  providerType: string,
  apiKey: string,
  adminApiKey?: string,
  workspaceId?: string,
): Promise<ConnectionCheckResult> {
  const definition = findProviderDefinition(providerType);
  if (!definition) {
    return {
      status: 'invalidKey',
      message: 'Nhà cung cấp chưa được hỗ trợ.',
    };
  }
  return checkProviderConnection(providerType, apiKey, {
    skipCache: true,
    adminApiKey,
    workspaceId,
  });
}

/** Ánh xạ bản ghi DB + số liệu tổng hợp thành dữ liệu trả về client. */
function toProviderView(
  provider: {
    id: string;
    name: string;
    providerType: string;
    apiKeyLast4: string | null;
    adminKeyLast4?: string | null;
    workspaceIdLast4?: string | null;
    status: string;
    lastCheckStatus: string | null;
    lastCheckedAt: Date | null;
    usageAvailable: boolean;
    modelsList: string | null;
    createdAt: Date;
    _sum?: {
      totalTokens: number | null;
      cost: number | null;
      requestCount?: number | null;
    };
  },
  keyStatuses?: { secret?: string | null; admin?: string | null },
): ProviderView {
  const definition = resolveDefinition(provider.providerType);

  return {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    providerName: definition.name,
    letter: definition.letter,
    maskedApiKey: maskKeyLast4(provider.apiKeyLast4),
    maskedAdminApiKey: maskKeyLast4(provider.adminKeyLast4),
    maskedWorkspaceId: maskKeyLast4(provider.workspaceIdLast4),
    status: provider.status,
    lastCheckStatus: provider.lastCheckStatus,
    lastCheckedAt: provider.lastCheckedAt,
    usageAvailable: provider.usageAvailable,
    models: parseModels(provider.modelsList),
    createdAt: provider.createdAt,
    totalTokens: provider._sum?.totalTokens ?? 0,
    totalCost: Number(provider._sum?.cost ?? 0),
    requestCount: provider._sum?.requestCount ?? 0,
    lastSyncedAt: provider.lastCheckedAt,
    secretKeyStatus: keyStatuses?.secret ?? null,
    adminKeyStatus: keyStatuses?.admin ?? null,
  };
}

/**
 * Lấy danh sách nhà cung cấp đã kết nối của người dùng kèm số liệu usage
 * thật được tổng hợp từ bảng `usage_records`.
 */
export async function listProviders(userId: string): Promise<ProvidersOverview> {
  const providers = await prisma.apiProvider.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      usageRecords: {
        select: { totalTokens: true, cost: true, model: true },
      },
    },
  });

  const views = providers.map((provider) => {
    const totalTokens = provider.usageRecords.reduce(
      (sum, r) => sum + r.totalTokens,
      0,
    );
    const totalCost = provider.usageRecords.reduce(
      (sum, r) => sum + Number(r.cost),
      0,
    );
    // Danh sách model thật: ưu tiên model đã đồng bộ từ nhà cung cấp,
    // nếu chưa có thì suy ra từ các bản ghi usage đã ghi nhận.
    const syncedModels = parseModels(provider.modelsList);
    const models =
      syncedModels.length > 0
        ? syncedModels
        : [
            ...new Set(
              provider.usageRecords
                .map((r) => r.model)
                .filter((m): m is string => Boolean(m)),
            ),
          ];
    return toProviderView(
      {
        id: provider.id,
        name: provider.name,
        providerType: provider.providerType,
        apiKeyLast4: provider.apiKeyLast4,
        adminKeyLast4: provider.adminKeyLast4,
        workspaceIdLast4: provider.workspaceIdLast4,
        status: provider.status,
        lastCheckStatus: provider.lastCheckStatus,
        lastCheckedAt: provider.lastCheckedAt,
        usageAvailable: provider.usageAvailable,
        modelsList: JSON.stringify(models),
        createdAt: provider.createdAt,
        _sum: {
          totalTokens,
          cost: totalCost,
          requestCount: provider.usageRecords.length,
        },
      },
      {
        secret: provider.secretKeyStatus,
        admin: provider.adminKeyStatus,
      },
    );
  });

  // Tổng hạn mức ngân sách đang áp dụng cho các nhà cung cấp.
  const budgetAgg = await prisma.budget.aggregate({
    where: { userId, apiProviderId: { not: null } },
    _sum: { monthlyLimit: true },
  });

  return {
    providers: views,
    totals: {
      providerCount: views.length,
      connectedCount: views.filter((p) => p.status === 'active').length,
      totalTokens: views.reduce((sum, p) => sum + p.totalTokens, 0),
      totalCost: views.reduce((sum, p) => sum + p.totalCost, 0),
      requestCount: views.reduce((sum, p) => sum + p.requestCount, 0),
      totalLimit: Number(budgetAgg._sum.monthlyLimit ?? 0),
    },
  };
}

/**
 * Tạo kết nối mới.
 *
 * Trước khi lưu, API Key được kiểm tra với nhà cung cấp thật. Chỉ khi kiểm tra
 * thành công (hoặc thiếu quyền billing — vẫn dùng được để gọi API) thì khoá
 * được mã hoá và lưu vào database.
 */
export async function createProvider(
  userId: string,
  input: {
    name: string;
    providerType: string;
    apiKey: string;
    adminApiKey?: string;
    workspaceId?: string;
    projectId?: string;
  },
): Promise<ProviderView> {
  const definition = findProviderDefinition(input.providerType);
  if (!definition) {
    throw new NotFoundError('Nhà cung cấp chưa được hỗ trợ.');
  }

  const check = await testConnection(
    input.providerType,
    input.apiKey,
    input.adminApiKey,
    input.workspaceId,
  );

  if (check.status === 'invalidKey' || check.status === 'unreachable') {
    // Không lưu khoá không hợp lệ — báo lỗi với mã HTTP tương ứng.
    throw new AppError(
      check.status === 'invalidKey' ? 400 : 502,
      check.message,
      check.status === 'invalidKey' ? 'INVALID_API_KEY' : 'PROVIDER_UNREACHABLE',
      check,
    );
  }

  const duplicate = await prisma.apiProvider.findFirst({
    where: {
      userId,
      providerType: input.providerType,
      name: input.name,
    },
  });
  if (duplicate) {
    throw new ConflictError(
      'Bạn đã có một kết nối cùng tên với nhà cung cấp này.',
      'PROVIDER_ALREADY_EXISTS',
    );
  }

  const provider = await prisma.apiProvider.create({
    data: {
      userId,
      projectId: input.projectId ?? null,
      name: input.name,
      providerType: input.providerType,
      baseUrl: definition.baseUrl,
      apiKeyCipher: encryptSecret(input.apiKey),
      apiKeyLast4: input.apiKey.slice(-4),
      // Admin API Key của tổ chức — mã hoá giống secret key, không lưu bản rõ.
      adminKeyCipher: input.adminApiKey
        ? encryptSecret(input.adminApiKey)
        : null,
      adminKeyLast4: input.adminApiKey ? input.adminApiKey.slice(-4) : null,
      // Workspace ID của Anthropic — mã hoá riêng, không lưu bản rõ.
      workspaceIdCipher: input.workspaceId
        ? encryptSecret(input.workspaceId)
        : null,
      workspaceIdLast4: input.workspaceId
        ? input.workspaceId.slice(-4)
        : null,
      lastCheckStatus: check.status,
      lastCheckedAt: new Date(),
      usageAvailable: definition.supportsUsage && check.status === 'success',
      modelsList: JSON.stringify(check.models ?? []),
      status: 'active',
      // Trạng thái từng loại khoá (Anthropic) — lưu riêng để giao diện hiển thị
      // đúng trạng thái Secret API Key và Admin API Key.
      secretKeyStatus: check.secretKey?.status ?? null,
      adminKeyStatus: check.adminKey?.status ?? null,
    },
  });

  // Đồng bộ usage ban đầu nếu nhà cung cấp hỗ trợ và khoá có quyền.
  if (definition.supportsUsage && check.status === 'success') {
    await syncProviderUsage(userId, provider.id).catch(() => undefined);
  }

  const fresh = await prisma.apiProvider.findUniqueOrThrow({
    where: { id: provider.id },
    include: { usageRecords: { select: { totalTokens: true, cost: true } } },
  });

  return toProviderView(
    {
      id: fresh.id,
      name: fresh.name,
      providerType: fresh.providerType,
      apiKeyLast4: fresh.apiKeyLast4,
      adminKeyLast4: fresh.adminKeyLast4,
      workspaceIdLast4: fresh.workspaceIdLast4,
      status: fresh.status,
      lastCheckStatus: fresh.lastCheckStatus,
      lastCheckedAt: fresh.lastCheckedAt,
      usageAvailable: fresh.usageAvailable,
      modelsList: fresh.modelsList,
      createdAt: fresh.createdAt,
      _sum: {
        totalTokens: fresh.usageRecords.reduce((s, r) => s + r.totalTokens, 0),
        cost: fresh.usageRecords.reduce((s, r) => s + Number(r.cost), 0),
        requestCount: fresh.usageRecords.length,
      },
    },
    {
      secret: check.secretKey?.status ?? null,
      admin: check.adminKey?.status ?? null,
    },
  );
}

/** Đổi tên kết nối. */
export async function renameProvider(
  userId: string,
  providerId: string,
  name: string,
): Promise<ProviderView> {
  const provider = await prisma.apiProvider.findFirst({
    where: { id: providerId, userId },
  });
  if (!provider) {
    throw new NotFoundError('Không tìm thấy kết nối nhà cung cấp.');
  }

  await prisma.apiProvider.update({
    where: { id: providerId },
    data: { name },
  });

  const fresh = await prisma.apiProvider.findUniqueOrThrow({
    where: { id: providerId },
    include: { usageRecords: { select: { totalTokens: true, cost: true } } },
  });

  return toProviderView({
    id: fresh.id,
    name: fresh.name,
    providerType: fresh.providerType,
    apiKeyLast4: fresh.apiKeyLast4,
    adminKeyLast4: fresh.adminKeyLast4,
    workspaceIdLast4: fresh.workspaceIdLast4,
    status: fresh.status,
    lastCheckStatus: fresh.lastCheckStatus,
    lastCheckedAt: fresh.lastCheckedAt,
    usageAvailable: fresh.usageAvailable,
    modelsList: fresh.modelsList,
    createdAt: fresh.createdAt,
    _sum: {
      totalTokens: fresh.usageRecords.reduce((s, r) => s + r.totalTokens, 0),
      cost: fresh.usageRecords.reduce((s, r) => s + Number(r.cost), 0),
      requestCount: fresh.usageRecords.length,
    },
  });
}

/**
 * Cập nhật khoá của một kết nối đã lưu — **từng loại khoá độc lập**.
 *
 * - Gửi `apiKey` → chỉ thay Secret API Key, Admin API Key giữ nguyên.
 * - Gửi `adminApiKey` → chỉ thay Admin API Key, Secret API Key giữ nguyên.
 * - Gửi `workspaceId` → chỉ thay Workspace ID.
 * - `clearAdminApiKey` → xoá Admin API Key đã lưu.
 *
 * Khoá mới luôn được kiểm tra với nhà cung cấp thật trước khi lưu, và luôn
 * được mã hoá (AES-256-GCM) — không bao giờ lưu bản rõ, không trả về client.
 */
export async function updateProviderKeys(
  userId: string,
  providerId: string,
  input: {
    apiKey?: string;
    adminApiKey?: string;
    workspaceId?: string;
    clearAdminApiKey?: boolean;
  },
): Promise<ProviderView> {
  const provider = await prisma.apiProvider.findFirst({
    where: { id: providerId, userId },
  });
  if (!provider) {
    throw new NotFoundError('Không tìm thấy kết nối nhà cung cấp.');
  }

  const currentApiKey = provider.apiKeyCipher
    ? decryptSecret(provider.apiKeyCipher)
    : '';
  const currentAdminKey = provider.adminKeyCipher
    ? decryptSecret(provider.adminKeyCipher)
    : undefined;
  const currentWorkspaceId = provider.workspaceIdCipher
    ? decryptSecret(provider.workspaceIdCipher)
    : undefined;

  // Khoá sau khi cập nhật — chỉ trường được gửi lên mới thay đổi.
  const nextApiKey = input.apiKey?.trim() || currentApiKey;
  const nextAdminKey = input.clearAdminApiKey
    ? undefined
    : input.adminApiKey?.trim() || currentAdminKey;
  const nextWorkspaceId = input.workspaceId?.trim() || currentWorkspaceId;

  if (!nextApiKey) {
    throw new NotFoundError('Kết nối chưa có Secret API Key để kiểm tra.');
  }

  // Kiểm tra khoá mới với nhà cung cấp thật trước khi lưu.
  const check = await testConnection(
    provider.providerType,
    nextApiKey,
    nextAdminKey,
    nextWorkspaceId,
  );

  if (check.status === 'invalidKey' || check.status === 'unreachable') {
    throw new AppError(
      check.status === 'invalidKey' ? 400 : 502,
      check.message,
      check.status === 'invalidKey' ? 'INVALID_API_KEY' : 'PROVIDER_UNREACHABLE',
      check,
    );
  }

  await prisma.apiProvider.update({
    where: { id: providerId },
    data: {
      apiKeyCipher: encryptSecret(nextApiKey),
      apiKeyLast4: nextApiKey.slice(-4),
      adminKeyCipher: nextAdminKey ? encryptSecret(nextAdminKey) : null,
      adminKeyLast4: nextAdminKey ? nextAdminKey.slice(-4) : null,
      workspaceIdCipher: nextWorkspaceId ? encryptSecret(nextWorkspaceId) : null,
      workspaceIdLast4: nextWorkspaceId ? nextWorkspaceId.slice(-4) : null,
      lastCheckStatus: check.status,
      lastCheckedAt: new Date(),
      usageAvailable:
        resolveDefinition(provider.providerType).supportsUsage &&
        check.status === 'success',
      modelsList: JSON.stringify(check.models ?? []),
      status: check.status === 'success' ? 'active' : 'error',
      secretKeyStatus: check.secretKey?.status ?? null,
      adminKeyStatus: check.adminKey?.status ?? null,
    },
  });

  const fresh = await prisma.apiProvider.findUniqueOrThrow({
    where: { id: providerId },
    include: { usageRecords: { select: { totalTokens: true, cost: true } } },
  });

  return toProviderView(
    {
      id: fresh.id,
      name: fresh.name,
      providerType: fresh.providerType,
      apiKeyLast4: fresh.apiKeyLast4,
      adminKeyLast4: fresh.adminKeyLast4,
      workspaceIdLast4: fresh.workspaceIdLast4,
      status: fresh.status,
      lastCheckStatus: fresh.lastCheckStatus,
      lastCheckedAt: fresh.lastCheckedAt,
      usageAvailable: fresh.usageAvailable,
      modelsList: fresh.modelsList,
      createdAt: fresh.createdAt,
      _sum: {
        totalTokens: fresh.usageRecords.reduce((s, r) => s + r.totalTokens, 0),
        cost: fresh.usageRecords.reduce((s, r) => s + Number(r.cost), 0),
        requestCount: fresh.usageRecords.length,
      },
    },
    {
      secret: check.secretKey?.status ?? null,
      admin: check.adminKey?.status ?? null,
    },
  );
}

/** Xoá kết nối và toàn bộ bản ghi usage của nó. */
export async function deleteProvider(
  userId: string,
  providerId: string,
): Promise<void> {
  const provider = await prisma.apiProvider.findFirst({
    where: { id: providerId, userId },
  });
  if (!provider) {
    throw new NotFoundError('Không tìm thấy kết nối nhà cung cấp.');
  }

  await prisma.usageRecord.deleteMany({
    where: { apiProviderId: providerId, userId },
  });
  await prisma.budget.deleteMany({ where: { apiProviderId: providerId } });
  await prisma.alert.deleteMany({ where: { apiProviderId: providerId } });
  await prisma.apiProvider.delete({ where: { id: providerId } });
}

/** Kiểm tra lại kết nối đã lưu bằng API Key đã mã hoá. */
export async function recheckProvider(
  userId: string,
  providerId: string,
): Promise<ConnectionCheckResult> {
  const provider = await prisma.apiProvider.findFirst({
    where: { id: providerId, userId },
  });
  if (!provider || !provider.apiKeyCipher) {
    throw new NotFoundError('Không tìm thấy kết nối nhà cung cấp.');
  }

  const apiKey = decryptSecret(provider.apiKeyCipher);
  // Admin API Key của người dùng (nếu có) — dùng để kiểm tra quyền
  // đọc Usage & Costs ở cấp tổ chức.
  const adminApiKey = provider.adminKeyCipher
    ? decryptSecret(provider.adminKeyCipher)
    : undefined;
  // Workspace ID của Anthropic (nếu có) — header `anthropic-workspace-id`.
  const workspaceId = provider.workspaceIdCipher
    ? decryptSecret(provider.workspaceIdCipher)
    : undefined;

  const check = await checkProviderConnection(provider.providerType, apiKey, {
    skipCache: true,
    adminApiKey,
    workspaceId,
  });

  await prisma.apiProvider.update({
    where: { id: providerId },
    data: {
      lastCheckStatus: check.status,
      lastCheckedAt: new Date(),
      usageAvailable:
        resolveDefinition(provider.providerType).supportsUsage &&
        check.status === 'success',
      modelsList: JSON.stringify(check.models ?? []),
      status: check.status === 'success' ? 'active' : 'error',
      secretKeyStatus: check.secretKey?.status ?? null,
      adminKeyStatus: check.adminKey?.status ?? null,
    },
  });

  return check;
}

/**
 * Đồng bộ usage & billing thật từ nhà cung cấp vào bảng `usage_records`.
 *
 * Dữ liệu được gom theo ngày + model, mỗi điểm trở thành một bản ghi usage
 * để Dashboard / Lịch sử hiển thị.
 */
export async function syncProviderUsage(
  userId: string,
  providerId: string,
): Promise<{ synced: number; message: string }> {
  const provider = await prisma.apiProvider.findFirst({
    where: { id: providerId, userId },
  });
  if (!provider || !provider.apiKeyCipher) {
    throw new NotFoundError('Không tìm thấy kết nối nhà cung cấp.');
  }

  const definition = resolveDefinition(provider.providerType);
  if (!definition.supportsUsage) {
    return {
      synced: 0,
      message:
        definition.usageNote ??
        'Nhà cung cấp này không cung cấp API usage/billing công khai.',
    };
  }

  const apiKey = decryptSecret(provider.apiKeyCipher);
  // Ưu tiên Admin API Key của người dùng (mỗi tổ chức OpenAI/Anthropic riêng);
  // nếu không có thì fallback về khoá của máy chủ.
  const adminApiKey = provider.adminKeyCipher
    ? decryptSecret(provider.adminKeyCipher)
    : undefined;
  // Workspace ID của Anthropic (tuỳ chọn) — header `anthropic-workspace-id`.
  const workspaceId = provider.workspaceIdCipher
    ? decryptSecret(provider.workspaceIdCipher)
    : undefined;

  // Dữ liệu OpenAI Usage/Costs là của toàn tổ chức — cần kiểm tra quyền
  // đọc dữ liệu Organization trước khi đồng bộ vào bản ghi của người dùng.
  //
  // Người dùng đã cung cấp Admin API Key của riêng họ → được đọc dữ liệu
  // tổ chức đó, không cần cờ bật cấp máy chủ.
  // Người dùng chưa có khoá → dùng khoá của máy chủ, và lúc này mới cần
  // cờ `OPENAI_ORG_ACCESS_ENABLED` để cho phép đọc dữ liệu tổ chức dùng chung.
  //
  // Không chặn bằng lỗi 403 ở đây: endpoint sync trả về thông điệp để giao
  // diện hiển thị, còn các endpoint đọc trực tiếp mới chặn cứng.
  if (provider.providerType === 'openai' && !adminApiKey) {
    try {
      assertOrgAccess(userId);
    } catch {
      return {
        synced: 0,
        message:
          'Chưa bật quyền đọc dữ liệu Usage/Costs cấp tổ chức. ' +
          'Hãy nhập Admin API Key của tổ chức OpenAI trong màn hình kết nối, ' +
          'hoặc bật OPENAI_ORG_ACCESS_ENABLED=true trên máy chủ.',
      };
    }
  }

  // Anthropic: Usage/Cost Report cần **Admin API Key** riêng — Secret API Key
  // không thay thế được. Thiếu khoá thì báo rõ thay vì báo sai lỗi khoá.
  if (provider.providerType === 'anthropic' && !adminApiKey) {
    return {
      synced: 0,
      message:
        'Chưa có Admin API Key của Anthropic nên chưa đọc được ' +
        'Usage Report / Cost Report của tổ chức. ' +
        'Hãy nhập Admin API Key (cần quyền đọc Usage & Costs ở cấp tổ chức) ' +
        'trong màn hình kết nối Claude.',
    };
  }

  const usage = await fetchProviderUsage(
    provider.providerType,
    apiKey,
    30,
    adminApiKey,
    workspaceId,
  );

  if (!usage.supported) {
    await prisma.apiProvider.update({
      where: { id: providerId },
      data: { usageAvailable: false, lastCheckedAt: new Date() },
    });
    return { synced: 0, message: usage.message };
  }

  if (usage.points.length === 0) {
    return { synced: 0, message: usage.message };
  }

  // Xoá dữ liệu cũ của khoảng thời gian đồng bộ để không nhân đôi.
  //
  // Phải xoá đúng khoảng đã đồng bộ (theo ngày của các bucket) chứ không dùng
  // "30 ngày gần nhất": nếu bucket rơi ngoài cửa sổ 30 ngày, bản ghi cũ sẽ
  // không bị xoá và mỗi lần đồng bộ lại sẽ nhân đôi số liệu.
  const dates = usage.points
    .map((point) => point.date)
    .filter((date): date is string => Boolean(date))
    .sort();

  if (dates.length > 0) {
    const rangeStart = new Date(`${dates[0]}T00:00:00.000Z`);
    const lastDate = dates[dates.length - 1];
    const rangeEnd = new Date(`${lastDate}T00:00:00.000Z`);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);

    await prisma.usageRecord.deleteMany({
      where: {
        apiProviderId: providerId,
        userId,
        occurredAt: { gte: rangeStart, lt: rangeEnd },
      },
    });
  } else {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    await prisma.usageRecord.deleteMany({
      where: { apiProviderId: providerId, userId, occurredAt: { gte: since } },
    });
  }

  await prisma.usageRecord.createMany({
    data: usage.points.map((point) => ({
      userId,
      projectId: provider.projectId,
      apiProviderId: providerId,
      model: point.model,
      endpoint: `${definition.baseUrl}/usage`,
      promptTokens: point.inputTokens,
      completionTokens: point.outputTokens,
      totalTokens: point.inputTokens + point.outputTokens,
      cost: point.cost,
      latencyMs: null,
      statusCode: 200,
      isSuccess: true,
      occurredAt: point.date ? new Date(`${point.date}T00:00:00.000Z`) : new Date(),
    })),
  });

  await prisma.apiProvider.update({
    where: { id: providerId },
    data: { lastCheckedAt: new Date(), usageAvailable: true },
  });

  return { synced: usage.points.length, message: usage.message };
}
