import { Router } from 'express';

import { requireAuth } from '../../middlewares/auth';
import { validate, validateQuery } from '../../middlewares/validate';
import {
  catalog,
  create,
  geminiUsage,
  list,
  openAICosts,
  openAIModels,
  openAIUsage,
  recheck,
  remove,
  sync,
  testConnection,
  update,
  updateKeys,
} from './providers.controller';
import {
  createProviderSchema,
  openaiCostQuerySchema,
  openaiUsageQuerySchema,
  testConnectionSchema,
  updateProviderKeysSchema,
  updateProviderSchema,
} from './providers.validation';

export const providersRouter = Router();

providersRouter.use(requireAuth);

// ── OpenAI Organization (Usage & Costs) ─────────────────────────────────
// Đặt trước `/:id` để không bị router hiểu nhầm "openai" là id.
providersRouter.get('/openai/models', openAIModels);
providersRouter.get(
  '/openai/usage',
  validateQuery(openaiUsageQuerySchema),
  openAIUsage,
);
providersRouter.get(
  '/openai/costs',
  validateQuery(openaiCostQuerySchema),
  openAICosts,
);

providersRouter.get('/catalog', catalog);
providersRouter.get('/', list);
providersRouter.post('/test', validate(testConnectionSchema), testConnection);
providersRouter.post('/', validate(createProviderSchema), create);
providersRouter.patch('/:id', validate(updateProviderSchema), update);
providersRouter.patch(
  '/:id/keys',
  validate(updateProviderKeysSchema),
  updateKeys,
);
providersRouter.delete('/:id', remove);
providersRouter.post('/:id/check', recheck);
providersRouter.post('/:id/sync', sync);
providersRouter.get('/:id/gemini-usage', geminiUsage);
