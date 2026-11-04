import { Router } from 'express';

import { requireAuth } from '../../middlewares/auth';
import { validateQuery } from '../../middlewares/validate';
import { detail, list, summary, analysis } from './usage.controller';
import { usageQuerySchema } from './usage.validation';

export const usageRouter = Router();

usageRouter.use(requireAuth);

usageRouter.get('/records', validateQuery(usageQuerySchema), list);
usageRouter.get('/summary', summary);
usageRouter.get('/analysis', analysis);
usageRouter.get('/records/:id', detail);
