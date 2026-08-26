import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { loadConfig } from '../../core/config.js';
import type { Database } from '../../core/database.js';
import type { AuditService } from '../audit/service.js';
import { AuthorizationMiddleware } from './middleware.js';

const response = () => ({ locals: {}, setHeader: vi.fn() }) as unknown as Response;

describe('platform and environment isolation', () => {
  it('does not disclose an unassigned platform', async () => {
    const db = {
      platform: { findUnique: vi.fn().mockResolvedValue({ id: 'platform-b', key: 'b' }) },
    } as unknown as Database;
    const middleware = new AuthorizationMiddleware(db, loadConfig({ NODE_ENV: 'test' }), {
      record: vi.fn(),
    } as unknown as AuditService);
    const request = {
      params: { platformKey: 'b' },
      header: vi.fn(),
      admin: { platformIds: new Set(['platform-a']), permissions: new Set(), assignmentScopes: [] },
    } as unknown as Request;
    const next = vi.fn();
    await middleware.requirePlatform(request, response(), next);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('narrows effective permissions to the requested environment', async () => {
    const db = {
      platform: { findUnique: vi.fn().mockResolvedValue({ id: 'platform-a', key: 'a' }) },
      platformEnvironment: {
        findUnique: vi.fn().mockResolvedValue({ id: 'prod-id', key: 'production' }),
      },
    } as unknown as Database;
    const middleware = new AuthorizationMiddleware(db, loadConfig({ NODE_ENV: 'test' }), {
      record: vi.fn(),
    } as unknown as AuditService);
    const request = {
      params: { platformKey: 'a' },
      header: vi.fn().mockReturnValue('production'),
      admin: {
        platformIds: new Set(['platform-a']),
        permissions: new Set(['a.read', 'a.staging.write']),
        assignmentScopes: [
          { platformId: 'platform-a', environmentId: undefined, permissions: ['a.read'] },
          {
            platformId: 'platform-a',
            environmentId: 'staging-id',
            permissions: ['a.staging.write'],
          },
        ],
      },
    } as unknown as Request;
    const res = response();
    const next = vi.fn();
    await middleware.requirePlatform(request, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.locals.effectivePermissions).toEqual(new Set(['a.read']));
  });

  it('rejects a missing CSRF token', () => {
    const middleware = new AuthorizationMiddleware(
      {} as Database,
      loadConfig({ NODE_ENV: 'test' }),
      { record: vi.fn() } as unknown as AuditService,
    );
    const next = vi.fn();
    middleware.requireCsrf(
      { header: vi.fn(), admin: { csrfToken: 'hash' } } as unknown as Request,
      response(),
      next,
    );
    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: 'CSRF_INVALID' });
  });
});
