import { Router } from 'express';

import { requireAuth } from '../../middlewares/auth';
import { recordEvent } from './app-usage.controller';

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
