import { Router } from 'express';

import { requireAuth } from '../../middlewares/auth';
import { recordEvent } from './app-usage.controller';
import { claimOrphanEvent } from './app-usage.service';

export const appUsageRouter = Router();

/**
 * Endpoint nhận sự kiện sử dụng ứng dụng từ Flutter App.
 *
 * `requireAuth` được đặt ở đây dưới dạng middleware tuỳ chọn: nếu request
 * mang access token hợp lệ thì `req.user` được gán, sự kiện sẽ gắn userId.
 * Request không có token vẫn được chấp nhận (app chưa đăng nhập).
 */
appUsageRouter.post('/events', (req, res, next) => {
  // Gọi requireAuth ở dạng "tuỳ chọn": không chặn request, chỉ bỏ qua lỗi 401.
  requireAuth(req, res, (error?: unknown) => {
    if (error) {
      req.user = undefined;
    }
    recordEvent(req, res, next);
  });
});

/**
 * POST /api/app-usage/claim — gắn userId cho sự kiện "mồ côi".
 *
 * Khi app khởi động trước khi người dùng đăng nhập, sự kiện `app_open` được
 * ghi với `userId = null`. Sau khi đăng nhập, app gọi endpoint này để "nhận"
 * lại sự kiện đó — backend gắn userId vào **chính bản ghi cũ** thay vì tạo
 * bản ghi mới, nhờ vậy số lượt mở ứng dụng không bị tính trùng.
 */
appUsageRouter.post('/claim', (req, res, next) => {
  requireAuth(req, res, async (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }

    try {
      const sessionId =
        typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
      const eventName =
        typeof req.body?.eventName === 'string' ? req.body.eventName : undefined;

      const claimed = await claimOrphanEvent(
        req.user?.id ?? null,
        sessionId,
        eventName,
      );

      res.status(200).json({ claimed });
    } catch (err) {
      next(err);
    }
  });
});
