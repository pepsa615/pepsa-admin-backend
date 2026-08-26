import { Router } from 'express';
import { asyncHandler } from '../../core/http.js';
import type { AuthorizationMiddleware } from '../auth/middleware.js';
import type { AuditController } from './controller.js';

export const auditRoutes = (controller: AuditController, auth: AuthorizationMiddleware) => {
  const router = Router();
  router.get(
    '/export',
    auth.requireSession,
    auth.requirePermission('admin.audit.read'),
    asyncHandler(controller.export),
  );
  router.get(
    '/verify',
    auth.requireSession,
    auth.requirePermission('admin.audit.read'),
    asyncHandler(controller.verify),
  );
  router.get(
    '/',
    auth.requireSession,
    auth.requirePermission('admin.audit.read'),
    asyncHandler(controller.list),
  );
  return router;
};
