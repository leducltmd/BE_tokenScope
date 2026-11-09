import { Router } from 'express';

import { requireAdmin, requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import {
  devices,
  heartbeat,
  poll,
  registerDevice,
  report,
  status,
} from './crash-testing.controller';
import {
  createCrashRequestSchema,
  heartbeatSchema,
  registerDeviceSchema,
  reportCrashRequestSchema,
} from './crash-testing.validation';
import { createRequest, listRequests } from './crash-testing.service';

export const crashTestingRouter = Router();

/**
 * ── Phần dành cho Admin Web ────────────────────────────────────────────────
 * Yêu cầu đăng nhập + quyền admin.
 */
crashTestingRouter.get('/status', requireAuth, requireAdmin, status);
crashTestingRouter.get('/devices', requireAuth, requireAdmin, devices);
crashTestingRouter.get('/requests', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const requests = await listRequests();
    res.status(200).json({ requests });
  } catch (error) {
    next(error);
  }
});

crashTestingRouter.post(
  '/requests',
  requireAuth,
  requireAdmin,
  validate(createCrashRequestSchema),
  async (req, res, next) => {
    try {
      const dto = req.body as {
        deviceId?: string;
        reason?: string;
      };
      const request = await createRequest({
        deviceId: dto.deviceId ?? null,
        requestedBy: req.admin!.id,
        requestedByName: req.admin!.name,
        reason: dto.reason ?? null,
      });
      res.status(201).json({ request });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * ── Phần dành cho Flutter App ─────────────────────────────────────────────
 * App đăng ký thiết bị, polling nhận lệnh crash và báo cáo kết quả.
 *
 * Các endpoint này không yêu cầu quyền admin vì app demo không có tài khoản
 * admin. Tính năng vẫn bị tắt hoàn toàn nếu `CRASH_TESTING_ENABLED` tắt hoặc
 * môi trường là production.
 */
crashTestingRouter.post(
  '/devices',
  validate(registerDeviceSchema),
  registerDevice,
);
crashTestingRouter.post(
  '/devices/heartbeat',
  validate(heartbeatSchema),
  heartbeat,
);
crashTestingRouter.get('/poll', poll);
crashTestingRouter.post(
  '/requests/:id/report',
  validate(reportCrashRequestSchema),
  report,
);
