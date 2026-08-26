import { Router } from 'express';
import { asyncHandler } from '../../core/http.js';
import type { AuthorizationMiddleware } from '../auth/middleware.js';
import type { ApprovalController } from './controller.js';

export const approvalRoutes = (controller: ApprovalController, auth: AuthorizationMiddleware) => {
  const router = Router();
  router.use(auth.requireSession);
  router.get('/', auth.requirePermission('admin.approvals.read'), asyncHandler(controller.list));
  router.post(
    '/',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.approvals.request'),
    asyncHandler(controller.create),
  );
  router.post(
    '/:id/decision',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.approvals.manage'),
    asyncHandler(controller.decide),
  );
  router.post('/:id/cancel', auth.requireCsrf, asyncHandler(controller.cancel));
  return router;
};
