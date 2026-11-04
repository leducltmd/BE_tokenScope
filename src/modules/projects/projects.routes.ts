import { Router } from 'express';

import { requireAuth } from '../../middlewares/auth';
import { detail, list } from './projects.controller';

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

projectsRouter.get('/', list);
projectsRouter.get('/:id', detail);
