import { Router } from 'express';

import { requireAuth } from '../../middlewares/auth';
import { overview } from './budgets.controller';

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);

budgetsRouter.get('/', overview);
