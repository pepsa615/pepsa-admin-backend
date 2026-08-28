import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../core/database.js';
import type { PlatformAdapter } from '../../integrations/adapter.js';
import { PlatformAdapterRegistry } from '../../integrations/registry.js';
import type { AuditService } from '../audit/service.js';
import { OperationService } from './service.js';
import { AppError } from '../../core/errors.js';

describe('platform isolation', () => {
  it('denies a discovered operation when its scoped permission is missing', async () => {
    const execute = vi.fn();
    const adapter: PlatformAdapter = {
      key: 'business-as-a-service',
      displayName: 'BAS',
      checkHealth: vi.fn(),
      capabilities: vi.fn().mockResolvedValue({
        version: '1',
        operations: [
          { key: 'businesses', method: 'GET', permission: 'bas.businesses.read', risk: 'medium' },
        ],
      }),
      execute,
    };
    const registry = new PlatformAdapterRegistry();
    registry.register(adapter);
    const database = {
      platform: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'platform-id', key: adapter.key, adapterType: adapter.key }),
      },
    } as unknown as Database;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new OperationService(database, registry, audit);
    await expect(
      service.execute({
        platformKey: adapter.key,
        operation: 'businesses',
        method: 'GET',
        actorId: 'admin-id',
        permissions: new Set(),
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(execute).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'DENIED' }));
  });

  it('queues an asynchronous mutation without holding the request open', async () => {
    const execute = vi.fn();
    const adapter: PlatformAdapter = {
      key: 'business-as-a-service',
      displayName: 'BAS',
      checkHealth: vi.fn(),
      capabilities: vi.fn().mockResolvedValue({
        version: '1',
        operations: [
          {
            key: 'businesses-review',
            method: 'POST',
            permission: 'bas.businesses.review',
            risk: 'high',
            async: true,
          },
        ],
      }),
      execute,
    };
    const registry = new PlatformAdapterRegistry();
    registry.register(adapter);
    const database = {
      platform: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'platform-id', key: adapter.key, adapterType: adapter.key }),
      },
      adminOperation: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'operation-id', status: 'PENDING' }),
      },
    } as unknown as Database;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new OperationService(database, registry, audit);
    await expect(
      service.execute({
        platformKey: adapter.key,
        operation: 'businesses-review',
        method: 'POST',
        actorId: 'admin-id',
        permissions: new Set(['bas.businesses.review']),
        requestId: 'request-id',
        idempotencyKey: 'key',
        reason: 'Approved customer review',
        payload: { businessId: 'business-id', status: 'APPROVED' },
      }),
    ).resolves.toEqual({ operationId: 'operation-id', status: 'PENDING' });
    expect(execute).not.toHaveBeenCalled();
    expect(database.adminOperation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });

  it('forwards only the resource scopes attached to the granting permission', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const adapter: PlatformAdapter = {
      key: 'business-as-a-service',
      displayName: 'BAS',
      checkHealth: vi.fn(),
      capabilities: vi.fn().mockResolvedValue({
        version: '1',
        operations: [
          { key: 'businesses', method: 'GET', permission: 'bas.businesses.read', risk: 'medium' },
        ],
      }),
      execute,
    };
    const registry = new PlatformAdapterRegistry();
    registry.register(adapter);
    const database = {
      platform: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'platform-id',
          key: adapter.key,
          adapterType: adapter.key,
        }),
      },
    } as unknown as Database;
    const service = new OperationService(database, registry, {
      record: vi.fn(),
    } as unknown as AuditService);
    await service.execute({
      platformKey: adapter.key,
      operation: 'businesses',
      method: 'GET',
      actorId: 'admin-id',
      permissions: new Set(['bas.businesses.read']),
      requestId: 'request-id',
      assignmentScopes: [
        {
          permissions: ['bas.businesses.read'],
          resourceScope: { businessIds: ['business-1'] },
        },
        { permissions: ['bas.orders.read'], resourceScope: { businessIds: ['business-2'] } },
      ],
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ resourceScopes: [{ businessIds: ['business-1'] }] }),
      }),
    );
  });

  it('does not retry a permanent platform conflict', async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new AppError(409, 'INVALID_REVIEW_STATE', 'Invalid transition'));
    const adapter: PlatformAdapter = {
      key: 'business-as-a-service',
      displayName: 'BAS',
      checkHealth: vi.fn(),
      capabilities: vi.fn(),
      execute,
    };
    const registry = new PlatformAdapterRegistry();
    registry.register(adapter);
    const update = vi.fn().mockResolvedValue({});
    const database = {
      adminOperation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'operation-id',
          type: 'businesses-review',
          attempts: 0,
          actorId: 'admin-id',
          platformId: 'platform-id',
          permission: 'bas.businesses.review',
          requestId: 'request-id',
          idempotencyKey: 'key',
          reason: 'Reviewed customer application',
          requestPayload: { businessId: 'business-id', status: 'UNDER_REVIEW' },
          platform: { adapterType: adapter.key, name: 'BAS' },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update,
      },
    } as unknown as Database;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new OperationService(database, registry, audit);

    await expect(service.processNext('worker-id')).resolves.toBe(true);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', errorCode: 'INVALID_REVIEW_STATE' }),
      }),
    );
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });
});
