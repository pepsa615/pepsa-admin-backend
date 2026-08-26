import { Router } from 'express';
import { asyncHandler } from '../../core/http.js';
import type { AuthorizationMiddleware } from '../auth/middleware.js';
import type { NotificationController } from './controller.js';

export const notificationRoutes = (
  controller: NotificationController,
  auth: AuthorizationMiddleware,
) => {
  const router = Router();
  router.use(auth.requireSession);
  router.get('/', asyncHandler(controller.list));
  router.post('/:id/read', auth.requireCsrf, asyncHandler(controller.read));
  router.post('/read-all', auth.requireCsrf, asyncHandler(controller.readAll));
  return router;
};
