import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../../core/config.js';
import { sha256 } from '../../core/crypto.js';
import type { Database } from '../../core/database.js';
import { AppError } from '../../core/errors.js';
import type { AuditService } from '../audit/service.js';

const cookieValue = (request: Request, name: string) =>
  request.headers.cookie
    ?.split(';')
    .map((item) => item.trim().split('='))
    .find(([key]) => key === name)?.[1];

export class AuthorizationMiddleware {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  sessionToken = (request: Request) => cookieValue(request, this.config.session.cookieName);

  requireSession = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const token = this.sessionToken(request);
      if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
      const session = await this.db.adminSession.findUnique({
        where: { tokenHash: sha256(`${token}:${this.config.session.secret}`) },
        include: {
          user: {
            include: {
              memberships: {
                where: {
                  status: 'ACTIVE',
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
              },
              assignments: {
                where: {
                  revokedAt: null,
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
                include: { role: { include: { permissions: { include: { permission: true } } } } },
              },
              emergencyGrants: {
                where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
              },
            },
          },
        },
      });
      const now = Date.now();
      if (
        !session ||
        session.revokedAt ||
        !session.mfaVerifiedAt ||
        session.expiresAt.getTime() <= now ||
        session.lastSeenAt.getTime() + this.config.session.idleMs <= now ||
        session.user.status !== 'ACTIVE'
      )
        throw new AppError(401, 'SESSION_EXPIRED', 'Session expired');
      const platformIds = new Set(session.user.memberships.map(({ platformId }) => platformId));
      for (const grant of session.user.emergencyGrants) platformIds.add(grant.platformId);
      const permissions = new Set(
        session.user.assignments
          .filter(
            (assignment) => assignment.platformId == null || platformIds.has(assignment.platformId),
          )
          .flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)),
      );
      for (const grant of session.user.emergencyGrants)
        for (const permission of grant.permissions) permissions.add(permission);
      const assignmentScopes = session.user.assignments.map((assignment) => ({
        platformId: assignment.platformId ?? undefined,
        environmentId: assignment.environmentId ?? undefined,
        resourceScope:
          assignment.resourceScope && typeof assignment.resourceScope === 'object'
            ? (assignment.resourceScope as Record<string, unknown>)
            : undefined,
        permissions: assignment.role.permissions.map(({ permission }) => permission.key),
      }));
      for (const grant of session.user.emergencyGrants)
        assignmentScopes.push({
          platformId: grant.platformId,
          environmentId: undefined,
          resourceScope: undefined,
          permissions: grant.permissions,
        });
      request.admin = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        sessionId: session.id,
        csrfToken: session.csrfHash,
        permissions,
        platformIds,
        assignmentScopes,
        stepUpAt: session.stepUpAt ?? undefined,
      };
      if (now - session.lastSeenAt.getTime() > 60_000)
        void this.db.adminSession.update({
          where: { id: session.id },
          data: { lastSeenAt: new Date() },
        });
      response.setHeader('cache-control', 'no-store');
      next();
    } catch (error) {
      next(error);
    }
  };

  requireCsrf = (request: Request, _response: Response, next: NextFunction) => {
    const supplied = request.header('x-csrf-token');
    if (!request.admin || !supplied || sha256(supplied) !== request.admin.csrfToken)
      return next(new AppError(403, 'CSRF_INVALID', 'CSRF token is missing or invalid'));
    next();
  };

  requirePermission =
    (permission: string) => async (request: Request, response: Response, next: NextFunction) => {
      if (
        request.admin?.permissions.has(permission) ||
        request.admin?.permissions.has('admin.super')
      )
        return next();
      await this.audit.record({
        actorId: request.admin?.id,
        action: 'authorization.denied',
        outcome: 'DENIED',
        requestId: response.locals.requestId,
        metadata: { requiredPermission: permission, path: request.path },
      });
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action'));
    };

  requirePlatform = async (request: Request, response: Response, next: NextFunction) => {
    const platform = await this.db.platform.findUnique({
      where: { key: String(request.params.platformKey) },
    });
    if (
      !platform ||
      (!request.admin?.platformIds.has(platform.id) &&
        !request.admin?.permissions.has('admin.super'))
    ) {
      await this.audit.record({
        actorId: request.admin?.id,
        action: 'authorization.platform.denied',
        outcome: 'DENIED',
        requestId: response.locals.requestId,
        metadata: { attemptedPlatformKey: String(request.params.platformKey) },
      });
      return next(new AppError(404, 'NOT_FOUND', 'Platform not found'));
    }
    const environmentKey = request.header('x-platform-environment') ?? 'production';
    const environment = await this.db.platformEnvironment.findUnique({
      where: { platformId_key: { platformId: platform.id, key: environmentKey } },
    });
    if (!environment) {
      await this.audit.record({
        actorId: request.admin?.id,
        platformId: platform.id,
        action: 'authorization.environment.denied',
        outcome: 'DENIED',
        requestId: response.locals.requestId,
        metadata: { attemptedEnvironmentKey: environmentKey },
      });
      return next(new AppError(404, 'ENVIRONMENT_NOT_FOUND', 'Platform environment not found'));
    }
    const matchingScopes =
      request.admin?.assignmentScopes.filter(
        (scope) =>
          scope.platformId == null ||
          (scope.platformId === platform.id &&
            (scope.environmentId == null || scope.environmentId === environment.id)),
      ) ?? [];
    const effectivePermissions = new Set(matchingScopes.flatMap(({ permissions }) => permissions));
    if (request.admin?.permissions.has('admin.super')) effectivePermissions.add('admin.super');
    response.locals.platform = platform;
    response.locals.platformEnvironment = environment;
    response.locals.effectivePermissions = effectivePermissions;
    response.locals.assignmentScopes = matchingScopes;
    next();
  };

  requireStepUp = (request: Request, _response: Response, next: NextFunction) => {
    if (!request.admin?.stepUpAt || request.admin.stepUpAt.getTime() < Date.now() - 5 * 60_000)
      return next(new AppError(428, 'STEP_UP_REQUIRED', 'Recent MFA verification is required'));
    next();
  };
}
