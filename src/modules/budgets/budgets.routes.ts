import { Router } from 'express';

import { requireAuth } from '../../middlewares/auth';
import { overview, update } from './budgets.controller';

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);

budgetsRouter.get('/', overview);
budgetsRouter.put('/', update);
budgetsRouter.post('/', update);
