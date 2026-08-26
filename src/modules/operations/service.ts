import { Prisma } from '@prisma/client';
import type { Database } from '../../core/database.js';
import { AppError, assertFound } from '../../core/errors.js';
import type { PlatformAdapterRegistry } from '../../integrations/registry.js';
import type { AuditService } from '../audit/service.js';
import { ApprovalService } from '../approvals/service.js';
import type { NotificationService } from '../notifications/service.js';

export class OperationService {
  constructor(
    private readonly db: Database,
    private readonly adapters: PlatformAdapterRegistry,
    private readonly audit: AuditService,
    private readonly notifications?: NotificationService,
  ) {}

  async execute(input: {
    platformKey: string;
    operation: string;
    method: 'GET' | 'POST';
    actorId: string;
    permissions: Set<string>;
    requestId: string;
    idempotencyKey?: string;
    reason?: string;
    payload?: Record<string, unknown>;
    query?: URLSearchParams;
    approvalId?: string;
    environmentId?: string;
    assignmentScopes?: Array<{
      resourceScope?: Record<string, unknown>;
      permissions: string[];
    }>;
  }) {
    const platform = assertFound(
      await this.db.platform.findUnique({ where: { key: input.platformKey } }),
      'Platform not found',
    );
    const adapter = this.adapters.get(platform.adapterType);
    if (!adapter)
      throw new AppError(503, 'ADAPTER_UNAVAILABLE', 'Platform adapter is not configured');
    const capabilities = await adapter.capabilities(platform.id);
    const capability = capabilities.operations.find(
      ({ key, method }) => key === input.operation && method === input.method,
    );
    if (!capability)
      throw new AppError(404, 'OPERATION_NOT_SUPPORTED', 'Platform operation is not supported');
    if (!input.permissions.has(capability.permission) && !input.permissions.has('admin.super')) {
      await this.audit.record({
        actorId: input.actorId,
        platformId: platform.id,
        action: `platform.${input.operation}`,
        outcome: 'DENIED',
        requestId: input.requestId,
        metadata: { permission: capability.permission },
      });
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this operation');
    }
    const grantingScopes = input.assignmentScopes?.filter(({ permissions }) =>
      permissions.includes(capability.permission),
    );
    const resourceScopes =
      input.permissions.has('admin.super') ||
      !grantingScopes?.length ||
      grantingScopes.some(({ resourceScope }) => !resourceScope)
        ? undefined
        : grantingScopes.map(({ resourceScope }) => resourceScope!);
    if (input.method === 'POST' && (!input.idempotencyKey || !input.reason))
      throw new AppError(
        422,
        'OPERATION_CONTEXT_REQUIRED',
        'Mutations require an idempotency key and reason',
      );
    if (input.method === 'POST' && capability.risk === 'critical')
      await ApprovalService.assertApproved(this.db, {
        id: input.approvalId,
        requesterId: input.actorId,
        action: 'operation.execute',
        platformId: platform.id,
        payload: {
          operation: input.operation,
          payload: input.payload ?? {},
        },
      });
    let record;
    if (input.method === 'POST') {
      const key = {
        platformId_idempotencyKey: {
          platformId: platform.id,
          idempotencyKey: input.idempotencyKey!,
        },
      };
      const existing = await this.db.adminOperation.findUnique({ where: key });
      if (existing) {
        if (existing.type !== input.operation || existing.actorId !== input.actorId)
          throw new AppError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was used for another operation',
          );
        if (existing.status === 'RUNNING' || existing.status === 'PENDING')
          return { operationId: existing.id, status: existing.status };
        if (existing.status === 'FAILED')
          throw new AppError(
            409,
            existing.errorCode ?? 'OPERATION_FAILED',
            'The original operation failed',
          );
        return existing.resultSummary;
      }
      try {
        record = await this.db.adminOperation.create({
          data: {
            platformId: platform.id,
            actorId: input.actorId,
            type: input.operation,
            status: capability.async ? 'PENDING' : 'RUNNING',
            idempotencyKey: input.idempotencyKey!,
            reason: input.reason!,
            requestPayload: input.payload as Prisma.InputJsonValue | undefined,
            requestId: input.requestId,
            permission: capability.permission,
            environmentId: input.environmentId,
            resourceScopes: resourceScopes as Prisma.InputJsonValue | undefined,
            ...(capability.async ? {} : { startedAt: new Date() }),
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new AppError(409, 'OPERATION_IN_PROGRESS', 'This operation is already in progress');
        throw error;
      }
    }
    if (record && capability.async) {
      await this.audit.record({
        actorId: input.actorId,
        platformId: platform.id,
        action: `platform.${input.operation}.queued`,
        targetType: 'AdminOperation',
        targetId: record.id,
        outcome: 'SUCCESS',
        reason: input.reason,
        requestId: input.requestId,
      });
      return { operationId: record.id, status: record.status };
    }
    try {
      const data = await adapter.execute({
        operation: input.operation,
        method: input.method,
        actor: {
          actorId: input.actorId,
          platformId: platform.id,
          permissions: [capability.permission],
          requestId: input.requestId,
          environmentId: input.environmentId,
          resourceScopes,
        },
        idempotencyKey: input.idempotencyKey,
        payload:
          input.method === 'POST' ? { ...input.payload, reason: input.reason } : input.payload,
        query: input.query,
      });
      if (record)
        record = await this.db.adminOperation.update({
          where: { id: record.id },
          data: {
            status: 'SUCCEEDED',
            resultSummary: data as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });
      await this.audit.record({
        actorId: input.actorId,
        platformId: platform.id,
        action: `platform.${input.operation}`,
        targetType: record ? 'AdminOperation' : undefined,
        targetId: record?.id,
        outcome: 'SUCCESS',
        reason: input.reason,
        requestId: input.requestId,
      });
      return data;
    } catch (error) {
      if (record)
        await this.db.adminOperation.update({
          where: { id: record.id },
          data: {
            status: 'FAILED',
            errorCode: error instanceof AppError ? error.code : 'PLATFORM_ERROR',
            completedAt: new Date(),
          },
        });
      await this.audit.record({
        actorId: input.actorId,
        platformId: platform.id,
        action: `platform.${input.operation}`,
        targetType: record ? 'AdminOperation' : undefined,
        targetId: record?.id,
        outcome: 'FAILURE',
        reason: input.reason,
        requestId: input.requestId,
        metadata: { errorCode: error instanceof AppError ? error.code : 'PLATFORM_ERROR' },
      });
      await this.notifications?.create({
        adminUserId: input.actorId,
        type: 'operation.failed',
        title: 'Platform operation failed',
        message: `${input.operation} failed on ${platform.name}.`,
        href: '/operations',
        metadata: {
          operationId: record?.id,
          errorCode: error instanceof AppError ? error.code : 'PLATFORM_ERROR',
        },
      });
      throw error;
    }
  }

  list(actorId: string, canReadAll: boolean) {
    return this.db.adminOperation.findMany({
      where: canReadAll ? {} : { actorId },
      include: {
        platform: { select: { key: true, name: true } },
        actor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
  }

  async get(id: string, actorId: string, canReadAll: boolean) {
    return assertFound(
      await this.db.adminOperation.findFirst({
        where: { id, ...(canReadAll ? {} : { actorId }) },
        include: {
          platform: { select: { key: true, name: true } },
          actor: { select: { id: true, name: true, email: true } },
        },
      }),
      'Operation not found',
    );
  }

  async processNext(workerId: string) {
    const pending = await this.db.adminOperation.findFirst({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { requestedAt: 'asc' },
      include: { platform: true },
    });
    if (!pending) return false;
    const claimed = await this.db.adminOperation.updateMany({
      where: { id: pending.id, status: 'PENDING' },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return true;
    const adapter = this.adapters.get(pending.platform.adapterType);
    try {
      if (!adapter)
        throw new AppError(503, 'ADAPTER_UNAVAILABLE', 'Platform adapter is not configured');
      const result = await adapter.execute({
        operation: pending.type,
        method: 'POST',
        actor: {
          actorId: pending.actorId,
          platformId: pending.platformId,
          permissions: [pending.permission],
          requestId: pending.requestId,
          environmentId: pending.environmentId ?? undefined,
          resourceScopes: Array.isArray(pending.resourceScopes)
            ? (pending.resourceScopes as Array<Record<string, unknown>>)
            : undefined,
        },
        idempotencyKey: pending.idempotencyKey,
        payload: {
          ...((pending.requestPayload as Record<string, unknown> | null) ?? {}),
          reason: pending.reason,
        },
      });
      await this.db.adminOperation.update({
        where: { id: pending.id },
        data: {
          status: 'SUCCEEDED',
          resultSummary: result as Prisma.InputJsonValue,
          completedAt: new Date(),
          errorCode: null,
        },
      });
      await this.audit.record({
        actorId: pending.actorId,
        platformId: pending.platformId,
        action: `platform.${pending.type}`,
        targetType: 'AdminOperation',
        targetId: pending.id,
        outcome: 'SUCCESS',
        reason: pending.reason,
        requestId: pending.requestId,
        metadata: { workerId },
      });
      await this.notifications?.create({
        adminUserId: pending.actorId,
        type: 'operation.succeeded',
        title: 'Platform operation completed',
        message: `${pending.type} completed on ${pending.platform.name}.`,
        href: '/operations',
        metadata: { operationId: pending.id },
      });
      return true;
    } catch (error) {
      const retry = pending.attempts + 1 < 3;
      const errorCode = error instanceof AppError ? error.code : 'PLATFORM_ERROR';
      await this.db.adminOperation.update({
        where: { id: pending.id },
        data: retry
          ? {
              status: 'PENDING',
              nextAttemptAt: new Date(Date.now() + 1_000 * 2 ** pending.attempts),
              errorCode,
            }
          : { status: 'FAILED', completedAt: new Date(), errorCode },
      });
      await this.audit.record({
        actorId: pending.actorId,
        platformId: pending.platformId,
        action: retry ? `platform.${pending.type}.retry` : `platform.${pending.type}`,
        targetType: 'AdminOperation',
        targetId: pending.id,
        outcome: 'FAILURE',
        reason: pending.reason,
        requestId: pending.requestId,
        metadata: { workerId, errorCode, retry },
      });
      if (!retry)
        await this.notifications?.create({
          adminUserId: pending.actorId,
          type: 'operation.failed',
          title: 'Platform operation failed',
          message: `${pending.type} failed on ${pending.platform.name}.`,
          href: '/operations',
          metadata: { operationId: pending.id, errorCode },
        });
      return true;
    }
  }
}
