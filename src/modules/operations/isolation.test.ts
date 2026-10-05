import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { loadConfig } from '../../core/config.js';
import type { Database } from '../../core/database.js';
import type { PlatformAdapter } from '../../integrations/adapter.js';
import { PlatformAdapterRegistry } from '../../integrations/registry.js';
import type { AuditService } from '../audit/service.js';
import { AuthorizationMiddleware } from '../auth/middleware.js';
import { OperationService } from './service.js';

const response = () => ({ locals: {}, setHeader: vi.fn() }) as unknown as Response;

function orderAdapter(): PlatformAdapter {
  return {
    key: 'pepsa-order',
    displayName: 'Pepsa Order',
    checkHealth: vi.fn(),
    capabilities: vi.fn().mockResolvedValue({
      version: '1',
      operations: [
        {
          key: 'credentials-issue',
          method: 'POST',
          permission: 'order.credentials.issue',
          risk: 'critical',
        },
      ],
    }),
    execute: vi.fn(),
  };
}

function paymentAdapter(): PlatformAdapter {
  return {
    key: 'pepsa-payment',
    displayName: 'Pepsa Payment',
    checkHealth: vi.fn(),
    capabilities: vi.fn().mockResolvedValue({
      version: '1',
      operations: [
        {
          key: 'platforms-rotate-key',
          method: 'POST',
          permission: 'payment.platforms.keys.rotate',
          risk: 'critical',
        },
      ],
    }),
    execute: vi.fn(),
  };
}

describe('cross-platform operation isolation', () => {
  it('denies payment operations when the actor only holds order permissions', async () => {
    const registry = new PlatformAdapterRegistry();
    registry.register(paymentAdapter());
    const database = {
      platform: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'payment-platform-id',
          key: 'pepsa-payment',
          adapterType: 'pepsa-payment',
        }),
      },
    } as unknown as Database;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new OperationService(database, registry, audit);

    await expect(
      service.execute({
        platformKey: 'pepsa-payment',
        operation: 'platforms-rotate-key',
        method: 'POST',
        actorId: 'order-only-admin',
        permissions: new Set(['order.credentials.issue', 'order.partners.read']),
        requestId: 'req-isolation-1',
        idempotencyKey: 'idem-1',
        reason: 'Attempted cross-platform mutate',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'DENIED',
        metadata: { permission: 'payment.platforms.keys.rotate' },
      }),
    );
  });

  it('denies order operations when the actor only holds payment permissions', async () => {
    const registry = new PlatformAdapterRegistry();
    registry.register(orderAdapter());
    const database = {
      platform: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-platform-id',
          key: 'pepsa-order',
          adapterType: 'pepsa-order',
        }),
      },
    } as unknown as Database;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new OperationService(database, registry, audit);

    await expect(
      service.execute({
        platformKey: 'pepsa-order',
        operation: 'credentials-issue',
        method: 'POST',
        actorId: 'payment-only-admin',
        permissions: new Set(['payment.platforms.keys.rotate', 'payment.platforms.read']),
        requestId: 'req-isolation-2',
        idempotencyKey: 'idem-2',
        reason: 'Attempted cross-platform mutate',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});

describe('single-env deploy isolation', () => {
  it('binds requirePlatform to the sole ACTIVE production environment', async () => {
    const db = {
      platform: {
        findUnique: vi.fn().mockResolvedValue({ id: 'order-platform-id', key: 'pepsa-order' }),
      },
      platformEnvironment: {
        findFirst: vi.fn().mockResolvedValue({ id: 'order-prod-env', key: 'production' }),
      },
    } as unknown as Database;
    const middleware = new AuthorizationMiddleware(db, loadConfig({ NODE_ENV: 'test' }), {
      record: vi.fn(),
    } as unknown as AuditService);
    const request = {
      params: { platformKey: 'pepsa-order' },
      header: vi.fn().mockReturnValue('sandbox'),
      admin: {
        platformIds: new Set(['order-platform-id']),
        permissions: new Set(['order.credentials.issue']),
        assignmentScopes: [
          {
            platformId: 'order-platform-id',
            environmentId: undefined,
            permissions: ['order.credentials.issue'],
          },
        ],
      },
    } as unknown as Request;
    const res = response();
    const next = vi.fn();
    await middleware.requirePlatform(request, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.locals.platformEnvironment).toEqual({ id: 'order-prod-env', key: 'production' });
    expect(res.locals.effectivePermissions).toEqual(new Set(['order.credentials.issue']));
    expect(db.platformEnvironment.findFirst).toHaveBeenCalledWith({
      where: { platformId: 'order-platform-id', key: 'production', status: 'ACTIVE' },
    });
  });
});
