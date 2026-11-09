import type { NextFunction, Request, Response } from 'express';

import { config } from '../../config';
import * as adminService from './admin.service';
import {
  getCrashlyticsStatus,
  getFirebaseAnalyticsSummary,
  getFirebaseAnalyticsTimeSeries,
} from './firebase-analytics.service';
import type {
  AdminRangeDto,
  AdminUserDetailQueryDto,
  AdminUsersQueryDto,
} from './admin.validation';

/** GET /api/admin/overview — Tổng quan số liệu cho Admin Dashboard. */
export async function overview(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await adminService.getOverview(config.crashlytics.projectId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/stats — Chuỗi thống kê theo ngày/tuần/tháng. */
export async function stats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { range } = (res.locals.query ?? req.query) as AdminRangeDto;
    const [series, features] = await Promise.all([
      adminService.getTimeSeries(range),
      adminService.getFeatureEvents(range === 'day' ? 1 : range === 'week' ? 7 : 30),
    ]);
    res.status(200).json({ range, series, features });
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/users — Danh sách người dùng kèm số liệu sử dụng. */
export async function users(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = (res.locals.query ?? req.query) as AdminUsersQueryDto;
    const result = await adminService.listUsers(query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/users/:id — Chi tiết + lịch sử sử dụng của một người dùng. */
export async function userDetail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { limit } = (res.locals.query ?? req.query) as AdminUserDetailQueryDto;
    const [user, daily] = await Promise.all([
      adminService.getUserDetail(req.params.id, limit),
      adminService.getUserDailyUsage(req.params.id, 14),
    ]);
    res.status(200).json({ user, daily });
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/analytics/firebase — Số liệu từ Firebase Analytics (GA4). */
export async function firebaseAnalytics(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const raw = Number(req.query.days ?? 30);
    const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 90) : 30;
    const [summary, timeSeries] = await Promise.all([
      getFirebaseAnalyticsSummary(days),
      getFirebaseAnalyticsTimeSeries(days),
    ]);
    res.status(200).json({
      summary,
      timeSeries,
      crashlytics: getCrashlyticsStatus(),
    });
  } catch (error) {
    next(error);
  }
}
