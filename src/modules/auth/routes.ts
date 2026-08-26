import { Router } from 'express';
import { asyncHandler } from '../../core/http.js';
import type { AuthController } from './controller.js';
import type { AuthorizationMiddleware } from './middleware.js';

export const authRoutes = (controller: AuthController, auth: AuthorizationMiddleware) => {
  const router = Router();
  router.post('/login', asyncHandler(controller.login));
  router.post('/password-recovery', asyncHandler(controller.requestPasswordReset));
  router.post('/password-reset', asyncHandler(controller.resetPassword));
  router.post('/mfa/verify', asyncHandler(controller.verifyMfa));
  router.post('/mfa/recover', asyncHandler(controller.recoverMfa));
  router.get('/session', auth.requireSession, asyncHandler(controller.session));
  router.get('/csrf', auth.requireSession, asyncHandler(controller.csrf));
  router.post('/step-up', auth.requireSession, auth.requireCsrf, asyncHandler(controller.stepUp));
  router.post('/logout', auth.requireSession, auth.requireCsrf, asyncHandler(controller.logout));
  return router;
};
