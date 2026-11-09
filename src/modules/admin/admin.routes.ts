import { Router } from 'express';

import { requireAdmin, requireAuth } from '../../middlewares/auth';
import { validateQuery } from '../../middlewares/validate';
import {
  firebaseAnalytics,
  overview,
  stats,
  userDetail,
  users,
} from './admin.controller';
import {
  adminRangeSchema,
  adminUserDetailQuerySchema,
  adminUsersQuerySchema,
} from './admin.validation';

export const adminRouter = Router();

/**
 * Toàn bộ module admin yêu cầu:
 * 1. Đã đăng nhập (`requireAuth`).
 * 2. Có vai trò admin (`requireAdmin`).
 */
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/overview', overview);
adminRouter.get('/stats', validateQuery(adminRangeSchema), stats);
adminRouter.get('/users', validateQuery(adminUsersQuerySchema), users);
adminRouter.get(
  '/users/:id',
  validateQuery(adminUserDetailQuerySchema),
  userDetail,
);
adminRouter.get('/analytics/firebase', firebaseAnalytics);
