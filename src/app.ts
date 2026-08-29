import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import type { AppConfig } from './core/config.js';
import { errorHandler, notFound, requestContext } from './core/http.js';
import { logger } from './core/logger.js';
import { healthRoutes } from './modules/health/routes.js';
import { prisma as defaultDatabase, type Database } from './core/database.js';
import { rateLimit } from './core/rate-limit.js';
import { metricsHandler, metricsMiddleware } from './core/metrics.js';
import { createAdapterRegistry } from './integrations/create-registry.js';
import { AccessController } from './modules/access/controller.js';
import { accessRoutes } from './modules/access/routes.js';
import { AccessService } from './modules/access/service.js';
import { AuditController } from './modules/audit/controller.js';
import { auditRoutes } from './modules/audit/routes.js';
import { AuditService } from './modules/audit/service.js';
import { AuthController } from './modules/auth/controller.js';
import { AuthorizationMiddleware } from './modules/auth/middleware.js';
import { authRoutes } from './modules/auth/routes.js';
import { AuthService } from './modules/auth/service.js';
import { OperationController } from './modules/operations/controller.js';
import { operationRoutes } from './modules/operations/routes.js';
import { OperationService } from './modules/operations/service.js';
import { PlatformController } from './modules/platforms/controller.js';
import { platformRoutes } from './modules/platforms/routes.js';
import { PlatformService } from './modules/platforms/service.js';
import { NotificationService } from './modules/notifications/service.js';
import { NotificationController } from './modules/notifications/controller.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { ApprovalService } from './modules/approvals/service.js';
import { ApprovalController } from './modules/approvals/controller.js';
import { approvalRoutes } from './modules/approvals/routes.js';
import { AccessReviewService } from './modules/access-reviews/service.js';
import { AccessReviewController } from './modules/access-reviews/controller.js';
import { accessReviewRoutes } from './modules/access-reviews/routes.js';
import { EmergencyAccessService } from './modules/emergency-access/service.js';
import { EmergencyAccessController } from './modules/emergency-access/controller.js';
import { emergencyAccessRoutes } from './modules/emergency-access/routes.js';
import { SessionService } from './modules/sessions/service.js';
import { SessionController } from './modules/sessions/controller.js';
import { sessionRoutes } from './modules/sessions/routes.js';
import { internalDeliveryRoutes } from './modules/internal-delivery/routes.js';

export function createApp(config: AppConfig, database: Database = defaultDatabase) {
  const app = express();

  const adapters = createAdapterRegistry(config);
  const audit = new AuditService(database);
  const notifications = new NotificationService(database);
  const authorization = new AuthorizationMiddleware(database, config, audit);
  const authController = new AuthController(
    new AuthService(database, config, audit),
    authorization,
    config,
  );

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    }),
  );
  app.use(
    cors({
      origin: config.frontendOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(requestContext);
  app.use(metricsMiddleware);
  app.use((pinoHttp as unknown as (options: object) => express.RequestHandler)({ logger }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/metrics', metricsHandler(config.metricsToken));
  app.use('/internal', internalDeliveryRoutes(config));
  app.use('/admin-api/v1/health', healthRoutes(database, adapters));
  app.use(
    '/admin-api/v1/auth',
    rateLimit(database, { windowMs: 60_000, limit: 20, namespace: 'auth' }),
    authRoutes(authController, authorization),
  );
  app.use(
    '/admin-api/v1',
    accessRoutes(new AccessController(new AccessService(database, audit, config)), authorization),
  );
  app.use(
    '/admin-api/v1/platforms',
    platformRoutes(
      new PlatformController(new PlatformService(database, adapters, audit)),
      authorization,
    ),
  );
  app.use('/admin-api/v1/audit', auditRoutes(new AuditController(audit), authorization));
  app.use(
    '/admin-api/v1/operations',
    operationRoutes(
      new OperationController(new OperationService(database, adapters, audit, notifications)),
      authorization,
    ),
  );
  app.use(
    '/admin-api/v1/approvals',
    approvalRoutes(
      new ApprovalController(new ApprovalService(database, audit, notifications)),
      authorization,
    ),
  );
  app.use(
    '/admin-api/v1/access-reviews',
    accessReviewRoutes(
      new AccessReviewController(new AccessReviewService(database, audit, notifications)),
      authorization,
    ),
  );
  app.use(
    '/admin-api/v1/emergency-access',
    emergencyAccessRoutes(
      new EmergencyAccessController(new EmergencyAccessService(database, audit, notifications)),
      authorization,
    ),
  );
  app.use(
    '/admin-api/v1/notifications',
    notificationRoutes(new NotificationController(notifications), authorization),
  );
  app.use(
    '/admin-api/v1/sessions',
    sessionRoutes(
      new SessionController(new SessionService(database, audit), config),
      authorization,
    ),
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
