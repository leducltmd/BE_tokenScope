import cors from 'cors';
import express from 'express';

import { isOriginAllowed } from './config';
import { errorHandler, notFoundHandler } from './middlewares/error';
import { authRouter } from './modules/auth/auth.routes';
import { budgetsRouter } from './modules/budgets/budgets.routes';
import { projectsRouter } from './modules/projects/projects.routes';
import { providersRouter } from './modules/providers/providers.routes';
import { usageRouter } from './modules/usage/usage.routes';

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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
