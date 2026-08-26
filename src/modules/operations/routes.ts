import { Router } from 'express';
import { asyncHandler } from '../../core/http.js';
import type { AuthorizationMiddleware } from '../auth/middleware.js';
import type { OperationController } from './controller.js';

export const operationRoutes = (controller: OperationController, auth: AuthorizationMiddleware) => {
  const router = Router();
  router.use(auth.requireSession);
  router.get('/', asyncHandler(controller.list));
  router.get('/records/:id', asyncHandler(controller.get));
  router.get('/:platformKey/:operation', auth.requirePlatform, asyncHandler(controller.read));
  router.post(
    '/:platformKey/:operation',
    auth.requirePlatform,
    auth.requireCsrf,
    auth.requireStepUp,
    asyncHandler(controller.mutate),
  );
  return router;
};
