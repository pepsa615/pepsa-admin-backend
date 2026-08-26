import { Router } from 'express';
import { asyncHandler } from '../../core/http.js';
import type { AuthorizationMiddleware } from '../auth/middleware.js';
import type { AccessController } from './controller.js';

export const accessRoutes = (controller: AccessController, auth: AuthorizationMiddleware) => {
  const router = Router();
  router.use(auth.requireSession);
  router.get(
    '/administrators',
    auth.requirePermission('admin.users.read'),
    asyncHandler(controller.list),
  );
  router.post(
    '/administrators',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.users.manage'),
    asyncHandler(controller.invite),
  );
  router.patch(
    '/administrators/:userId/status',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.users.manage'),
    asyncHandler(controller.status),
  );
  router.put(
    '/administrators/:userId/membership',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.access.manage'),
    asyncHandler(controller.membership),
  );
  router.post(
    '/administrators/:userId/assignments',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.access.manage'),
    asyncHandler(controller.assign),
  );
  router.post(
    '/assignments/:assignmentId/revoke',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.access.manage'),
    asyncHandler(controller.revoke),
  );
  router.get('/roles', auth.requirePermission('admin.roles.read'), asyncHandler(controller.roles));
  router.post(
    '/roles',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.roles.manage'),
    asyncHandler(controller.createRole),
  );
  router.get(
    '/permissions',
    auth.requirePermission('admin.roles.read'),
    asyncHandler(controller.permissions),
  );
  return router;
};
