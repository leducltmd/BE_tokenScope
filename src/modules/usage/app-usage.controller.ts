import type { NextFunction, Request, Response } from 'express';

import { recordAppUsageEvent, type AppUsageEventInput } from './app-usage.service';
import { BadRequestError } from '../../utils/errors';

/**
 * POST /api/app-usage/events — Flutter App báo cáo sự kiện sử dụng.
 *
 * Endpoint này **không** bắt buộc xác thực: app có thể ghi nhận sự kiện
 * trước khi người dùng đăng nhập (ví dụ lượt mở app đầu tiên). Nếu request
 * có access token hợp lệ, sự kiện sẽ được gắn userId tương ứng.
 */
export async function recordEvent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as Partial<AppUsageEventInput>;

    if (!body.eventName || typeof body.eventName !== 'string') {
      throw new BadRequestError('Thiếu tên sự kiện.');
    }

    const event = await recordAppUsageEvent(
      {
        eventName: body.eventName,
        feature: body.feature ?? null,
        screen: body.screen ?? null,
        sessionId: body.sessionId ?? null,
        platform: body.platform ?? null,
        appVersion: body.appVersion ?? null,
        metadata: body.metadata ?? null,
        occurredAt: body.occurredAt ?? null,
      },
      req.user?.id ?? null,
    );

    res.status(201).json({ event });
  } catch (error) {
    next(error);
  }
}
