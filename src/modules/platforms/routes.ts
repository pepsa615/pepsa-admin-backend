import { Router } from 'express';
import { asyncHandler } from '../../core/http.js';
import type { AuthorizationMiddleware } from '../auth/middleware.js';
import type { PlatformController } from './controller.js';

export const platformRoutes = (controller: PlatformController, auth: AuthorizationMiddleware) => {
  const router = Router();
  router.use(auth.requireSession);
  router.get('/', asyncHandler(controller.list));
  router.post(
    '/',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.platforms.manage'),
    asyncHandler(controller.create),
  );
  router.patch(
    '/:id',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.platforms.manage'),
    asyncHandler(controller.update),
  );
  router.post(
    '/:id/environments',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.platforms.manage'),
    asyncHandler(controller.addEnvironment),
  );
  router.post(
    '/:id/credentials/rotate',
    auth.requireCsrf,
    auth.requireStepUp,
    auth.requirePermission('admin.platforms.manage'),
    asyncHandler(controller.rotateCredentials),
  );
  router.get('/:platformKey/health', auth.requirePlatform, asyncHandler(controller.health));
  router.get(
    '/:platformKey/capabilities',
    auth.requirePlatform,
    asyncHandler(controller.capabilities),
  );
  return router;
};
