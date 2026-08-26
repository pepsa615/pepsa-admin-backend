import { Router } from 'express';
import { asyncHandler } from '../../core/http.js';
import type { AuthorizationMiddleware } from '../auth/middleware.js';
import type { SessionController } from './controller.js';

export const sessionRoutes = (controller: SessionController, auth: AuthorizationMiddleware) => {
  const router = Router();
  router.use(auth.requireSession);
  router.get('/', asyncHandler(controller.list));
  router.post('/:id/revoke', auth.requireCsrf, auth.requireStepUp, asyncHandler(controller.revoke));
  return router;
};
