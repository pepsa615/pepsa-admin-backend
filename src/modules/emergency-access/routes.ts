import { Router } from 'express';
import { asyncHandler } from '../../core/http.js';
import type { AuthorizationMiddleware } from '../auth/middleware.js';
import type { EmergencyAccessController } from './controller.js';

export const emergencyAccessRoutes = (
  controller: EmergencyAccessController,
  auth: AuthorizationMiddleware,
) => {
  const router = Router();
  router.use(auth.requireSession);
  router.get('/', asyncHandler(controller.list));
  router.post(
    '/',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.emergency.request'),
    asyncHandler(controller.create),
  );
  router.post(
    '/:id/decision',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.emergency.approve'),
    asyncHandler(controller.decide),
  );
  router.post(
    '/:id/revoke',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.emergency.approve'),
    asyncHandler(controller.revoke),
  );
  return router;
};
