import type { NextFunction, Request, Response } from 'express';

import * as usageService from './usage.service';
import type { UsageQueryDto } from './usage.validation';

/** GET /api/usage/records — Danh sách bản ghi sử dụng. */
export async function list(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = (res.locals.query ?? req.query) as UsageQueryDto;
    const result = await usageService.listUsageRecords(req.user!.id, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/usage/summary — Tổng hợp token, chi phí theo nhà cung cấp. */
export async function summary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await usageService.getUsageSummary(req.user!.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/usage/records/:id — Chi tiết một bản ghi. */
export async function detail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const record = await usageService.getUsageRecord(req.user!.id, req.params.id);
    res.status(200).json({ record });
  } catch (error) {
    next(error);
  }
}

/** GET /api/usage/analysis — Số liệu phân tích chi tiết theo khoảng ngày. */
export async function analysis(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const raw = Number(req.query.days ?? 7);
    const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 90) : 7;
    const result = await usageService.getUsageAnalysis(req.user!.id, days);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
