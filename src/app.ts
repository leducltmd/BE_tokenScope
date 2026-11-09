import cors from 'cors';
import express from 'express';

import { isOriginAllowed } from './config';
import { errorHandler, notFoundHandler } from './middlewares/error';
import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { budgetsRouter } from './modules/budgets/budgets.routes';
import { crashTestingRouter } from './modules/crash-testing/crash-testing.routes';
import { projectsRouter } from './modules/projects/projects.routes';
import { providersRouter } from './modules/providers/providers.routes';
import { usageRouter } from './modules/usage/usage.routes';
import { appUsageRouter } from './modules/usage/app-usage.routes';

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(
    cors({
      // Kiểm tra Origin thủ công để cho phép mọi cổng localhost ở dev —
      // Flutter Web dev server hay tự chọn cổng ngẫu nhiên.
      // Origin bị từ chối chỉ đơn giản là không có header CORS (trình duyệt
      // tự chặn), không nên trả lỗi 500.
      origin: (origin, callback) => {
        callback(null, !origin || isOriginAllowed(origin));
      },
      credentials: true,
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'TokenScope API',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/providers', providersRouter);
  app.use('/api/usage', usageRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/budgets', budgetsRouter);

  // Admin Web — yêu cầu đăng nhập + quyền admin (kiểm tra trong router).
  app.use('/api/admin', adminRouter);

  // Crash Testing — phần Admin (requireAdmin) và phần Flutter App.
  app.use('/api/crash-testing', crashTestingRouter);

  // Ghi nhận sự kiện sử dụng ứng dụng từ Flutter App.
  app.use('/api/app-usage', appUsageRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
