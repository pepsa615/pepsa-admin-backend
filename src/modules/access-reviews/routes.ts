import { Router } from 'express';
import { asyncHandler } from '../../core/http.js';
import type { AuthorizationMiddleware } from '../auth/middleware.js';
import type { AccessReviewController } from './controller.js';

export const accessReviewRoutes = (
  controller: AccessReviewController,
  auth: AuthorizationMiddleware,
) => {
  const router = Router();
  router.use(auth.requireSession);
  router.get('/', auth.requirePermission('admin.reviews.read'), asyncHandler(controller.list));
  router.post(
    '/',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.reviews.manage'),
    asyncHandler(controller.create),
  );
  router.post(
    '/:reviewId/items/:itemId/decision',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.reviews.read'),
    asyncHandler(controller.decide),
  );
  return router;
};
