import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import * as providersService from './providers.service';
import * as openaiOrgService from './openai.org.service';
import { prisma } from '../../config/prisma';
import { AppError, NotFoundError } from '../../utils/errors';
import { readGeminiDemoCall } from '../usage/gemini-call-import';
import { geminiUsageMetrics, readGeminiUsage } from './gemini-usage.service';
import {
  toArray,
  type CreateProviderDto,
  type OpenAICostQueryDto,
  type OpenAIUsageQueryDto,
  type TestConnectionDto,
  type UpdateProviderDto,
  type UpdateProviderKeysDto,
} from './providers.validation';
import type {
  BucketWidth,
  CostGroupBy,
  UsageGroupBy,
} from './openai.service';

const geminiUsageSnapshotSchema = z.object({
  project: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  model: z.string().min(1),
  inputTokensApproximate: z.string().regex(/^\d+$/),
  outputTokens: z.string().regex(/^\d+$/),
});

/** Số giây hiện tại — dùng làm mốc kết thúc mặc định. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Tính khoảng thời gian truy vấn từ query.
 *
 * Ưu tiên `start_time` / `end_time` nếu có, ngược lại dùng `days` gần nhất.
 */
function resolveRange(query: {
  days: number;
  start_time?: number;
  end_time?: number;
}): { startTime: number; endTime: number } {
  const endTime = query.end_time ?? nowSeconds();
  const startTime = query.start_time ?? endTime - query.days * 24 * 60 * 60;
  return { startTime, endTime };
}

/** GET /api/providers/catalog — Danh mục nhà cung cấp hỗ trợ kết nối. */
export function catalog(_req: Request, res: Response): void {
  res.status(200).json({ providers: providersService.listProviderCatalog() });
}

/** GET /api/providers — Danh sách nhà cung cấp đã kết nối + số liệu usage. */
export async function list(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const overview = await providersService.listProviders(req.user!.id);
    res.status(200).json(overview);
  } catch (error) {
    next(error);
  }
}

/** POST /api/providers/test — Kiểm tra API Key với nhà cung cấp thật. */
export async function testConnection(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = req.body as TestConnectionDto;
    const result = await providersService.testConnection(
      dto.providerType,
      dto.apiKey,
      dto.adminApiKey,
      dto.workspaceId,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/providers — Tạo kết nối mới (lưu API key đã mã hoá). */
export async function create(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = req.body as CreateProviderDto;
    const provider = await providersService.createProvider(req.user!.id, dto);
    res.status(201).json({
      message: 'Kết nối nhà cung cấp thành công.',
      provider,
    });
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/providers/:id — Đổi tên kết nối. */
export async function update(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = req.body as UpdateProviderDto;
    const provider = await providersService.renameProvider(
      req.user!.id,
      req.params.id,
      dto.name,
    );
    res.status(200).json({ message: 'Đã cập nhật tên kết nối.', provider });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/providers/:id/keys — Cập nhật khoá của kết nối đã lưu.
 *
 * Mỗi loại khoá được cập nhật **độc lập** — chỉ trường được gửi lên mới
 * thay đổi. Khoá mới luôn được kiểm tra với nhà cung cấp thật trước khi lưu
 * và luôn được mã hoá.
 */
export async function updateKeys(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = req.body as UpdateProviderKeysDto;
    const provider = await providersService.updateProviderKeys(
      req.user!.id,
      req.params.id,
      dto,
    );
    res.status(200).json({ message: 'Đã cập nhật khoá nhà cung cấp.', provider });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/providers/:id — Xoá kết nối. */
export async function remove(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await providersService.deleteProvider(req.user!.id, req.params.id);
    res.status(200).json({ message: 'Đã xoá kết nối nhà cung cấp.' });
  } catch (error) {
    next(error);
  }
}

/** POST /api/providers/:id/check — Kiểm tra lại kết nối đã lưu. */
export async function recheck(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await providersService.recheckProvider(
      req.user!.id,
      req.params.id,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/providers/:id/sync — Đồng bộ usage & billing từ nhà cung cấp. */
export async function sync(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await providersService.syncProviderUsage(
      req.user!.id,
      req.params.id,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function geminiUsage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const provider = await prisma.apiProvider.findFirst({
      where: { id: req.params.id, userId: req.user!.id, providerType: 'google' },
      select: { id: true },
    });
    if (!provider) throw new NotFoundError('Không tìm thấy kết nối Gemini.');

    const latestCall = await readGeminiDemoCall();
    if (latestCall) {
      const { model, usageMetadata: counts } = latestCall;
      const tokens = [
        ['Token đầu vào', counts.promptTokenCount ?? 0],
        ['Token câu trả lời', counts.candidatesTokenCount ?? 0],
        ['Token suy luận', counts.thoughtsTokenCount ?? 0],
        ['Tổng token của lượt gọi', counts.totalTokenCount],
      ] as const;
      res.set('Cache-Control', 'no-store').json({
        latestCall: true,
        model: model || 'Gemini',
        metrics: tokens.map(([label, count]) => ({
          label,
          total: String(count),
          rows: [],
        })),
      });
      return;
    }

    const configuredProviderId = process.env.GEMINI_MONITORING_PROVIDER_ID?.trim();
    const project = process.env.GEMINI_MONITORING_PROJECT_ID?.trim();
    const accessToken = process.env.GEMINI_MONITORING_ACCESS_TOKEN?.trim();
    if (configuredProviderId !== provider.id || !project) {
      throw new AppError(
        503,
        'Kết nối Gemini này chưa được cấu hình Cloud Monitoring trên máy chủ TokenScope.',
        'GEMINI_MONITORING_NOT_CONFIGURED',
      );
    }

    const snapshotConfig = process.env.GEMINI_USAGE_DEMO_SNAPSHOT;
    if (snapshotConfig) {
      const snapshot = geminiUsageSnapshotSchema.parse(JSON.parse(snapshotConfig));
      if (snapshot.project !== project) {
        throw new AppError(503, 'Project của dữ liệu đã ghi nhận không khớp cấu hình.', 'GEMINI_SNAPSHOT_PROJECT_MISMATCH');
      }
      res.set('Cache-Control', 'no-store').json({
        project,
        snapshotDate: snapshot.date,
        metrics: [
          {
            label: 'Token đầu vào (xấp xỉ)',
            rows: [{ model: snapshot.model, tokens: snapshot.inputTokensApproximate }],
          },
          {
            label: 'Token đầu ra',
            rows: [{ model: snapshot.model, tokens: snapshot.outputTokens }],
          },
        ],
      });
      return;
    }

    const { start, end, metrics } = await readGeminiUsage(project, accessToken, 28).catch(() => {
      throw new AppError(
        503,
        'Máy chủ TokenScope chưa xác thực được với Google Cloud Monitoring.',
        'GEMINI_MONITORING_AUTH_FAILED',
      );
    });
    res.set('Cache-Control', 'no-store').json({
      project,
      start,
      end,
      metrics: metrics.map((result, index) => ({
        label: geminiUsageMetrics[index][0],
        error: result.status === 'rejected' ? 'Không đọc được chỉ số từ Cloud Monitoring.' : null,
        rows: result.status === 'fulfilled'
          ? [...result.value].map(([model, tokens]) => ({ model, tokens: String(tokens) }))
          : [],
        total: result.status === 'fulfilled' && index === 0 && result.value.size
          ? String([...result.value.values()].reduce((sum, tokens) => sum + tokens, 0n))
          : null,
      })),
    });
  } catch (error) {
    next(error);
  }
}


/**
 * GET /api/providers/openai/models — Danh sách model OpenAI.
 *
 * Dùng Secret API Key (`OPENAI_API_KEY`) cấu hình trên backend.
 */
export async function openAIModels(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await openaiOrgService.getOpenAIModels();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/providers/openai/usage — Usage cấp tổ chức OpenAI.
 *
 * Dùng Admin API Key (`OPENAI_ADMIN_API_KEY`) cấu hình trên backend.
 */
export async function openAIUsage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = (res.locals.query ?? req.query) as OpenAIUsageQueryDto;
    const { startTime, endTime } = resolveRange(query);

    const result = await openaiOrgService.getOrganizationUsage(req.user!.id, {
      startTime,
      endTime,
      bucketWidth: query.bucket_width as BucketWidth,
      projectIds: toArray(query.project_ids),
      models: toArray(query.models),
      groupBy: toArray(query.group_by) as UsageGroupBy[] | undefined,
      limit: query.limit,
      page: query.page,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/providers/openai/costs — Chi phí cấp tổ chức OpenAI.
 *
 * Dùng Admin API Key (`OPENAI_ADMIN_API_KEY`) cấu hình trên backend.
 */
export async function openAICosts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = (res.locals.query ?? req.query) as OpenAICostQueryDto;
    const { startTime, endTime } = resolveRange(query);

    const result = await openaiOrgService.getOrganizationCosts(req.user!.id, {
      startTime,
      endTime,
      bucketWidth: '1d',
      projectIds: toArray(query.project_ids),
      lineItems: toArray(query.line_items),
      groupBy: toArray(query.group_by) as CostGroupBy[] | undefined,
      limit: query.limit,
      page: query.page,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
