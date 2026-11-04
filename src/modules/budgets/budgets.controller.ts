import type { NextFunction, Request, Response } from 'express';

import * as budgetsService from './budgets.service';

/** GET /api/budgets — Số liệu ngân sách thật của chu kỳ hiện tại. */
export async function overview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await budgetsService.getBudgetOverview(req.user!.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
