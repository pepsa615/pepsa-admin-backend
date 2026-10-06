import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../core/errors.js';
import { PepsaOrderAdapter, pepsaOrderRouteCatalogue } from './index.js';

function createAdapter(retries = 1, circuitThreshold = 5) {
  return new PepsaOrderAdapter(
    'https://order.example',
    1000,
    'pepsa-order',
    'signing-secret-long-enough',
    retries,
    circuitThreshold,
    30_000,
  );
}

describe('PepsaOrderAdapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exposes the Phase 0 capability catalogue', async () => {
    const adapter = createAdapter();
    const capabilities = await adapter.capabilities('platform-id');
    expect(capabilities.version).toBe('1');
    expect(capabilities.operations.map((op) => op.key)).toEqual(
      pepsaOrderRouteCatalogue.map((route) => route.key),
    );
    expect(capabilities.operations.find((op) => op.key === 'catalog-read')).toMatchObject({
      method: 'GET',
      permission: 'order.catalog.read',
      risk: 'low',
    });
    expect(capabilities.operations.find((op) => op.key === 'partners-list')).toMatchObject({
      method: 'GET',
      permission: 'order.partners.read',
      risk: 'low',
    });
    expect(
      capabilities.operations.find((op) => op.key === 'processing-run-optimize'),
    ).toMatchObject({
      method: 'POST',
      permission: 'order.processing.run',
      async: true,
    });
    expect(capabilities.operations.find((op) => op.key === 'policies-publish')).toMatchObject({
      method: 'POST',
      permission: 'order.operations.policies.write',
      risk: 'critical',
    });
  });

  it('probes fleet health for platform availability', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter();
    await expect(adapter.checkHealth('platform-id')).resolves.toMatchObject({
      status: 'available',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://order.example/internal/v1/fleet/health',
    );
  });

  it('sends a signed actor token for catalog reads with correlated request id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { categories: [] } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter();
    await expect(
      adapter.execute({
        operation: 'catalog-read',
        method: 'GET',
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['order.catalog.read'],
          requestId: 'req-catalog',
        },
      }),
    ).resolves.toEqual({ categories: [] });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-request-id']).toBe('req-catalog');
    expect(headers.authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
    const payload = JSON.parse(
      Buffer.from(
        headers.authorization!.replace(/^Bearer /, '').split('.')[1]!,
        'base64url',
      ).toString(),
    ) as {
      aud?: string;
      platform?: string;
      permissions?: string[];
      requestId?: string;
    };
    expect(payload).toMatchObject({
      aud: 'pepsa-order',
      platform: 'pepsa-order',
      permissions: ['order.catalog.read'],
      requestId: 'req-catalog',
    });
    expect(headers['x-operator-id']).toBeUndefined();
  });

  it('propagates mutation attribution headers for partner create', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: 'partner-1' } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter();
    await expect(
      adapter.execute({
        operation: 'partners-create',
        method: 'POST',
        idempotencyKey: 'idem-1',
        payload: { name: 'Acme', reason: 'Onboard partner for sandbox testing' },
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['order.partners.write'],
          requestId: 'req-mutate',
        },
      }),
    ).resolves.toEqual({ id: 'partner-1' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('POST');
    expect(headers['x-operator-id']).toBe('admin-1');
    expect(headers['x-change-reason']).toBe('Onboard partner for sandbox testing');
    expect(headers['x-request-id']).toBe('req-mutate');
    expect(headers['idempotency-key']).toBe('idem-1');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Acme' });
  });

  it('maps partners-update to destination PATCH and substitutes path params', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter();
    await adapter.execute({
      operation: 'partners-update',
      method: 'POST',
      idempotencyKey: 'idem-2',
      payload: {
        partnerId: 'partner-uuid',
        active: false,
        reason: 'Deactivate partner after churn',
      },
      actor: {
        actorId: 'admin-1',
        platformId: 'platform-id',
        permissions: ['order.partners.write'],
        requestId: 'req-patch',
      },
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://order.example/internal/v1/partners/partner-uuid',
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('PATCH');
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      active: false,
    });
  });

  it('fails closed when required path params are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter();
    await expect(
      adapter.execute({
        operation: 'credentials-revoke',
        method: 'POST',
        idempotencyKey: 'idem-3',
        payload: { reason: 'Rotate compromised credential' },
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['order.credentials.revoke'],
          requestId: 'req-missing',
        },
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_PATH_PARAM_REQUIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries safe reads on transient failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { categories: ['a'] } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter(1);
    await expect(
      adapter.execute({
        operation: 'catalog-read',
        method: 'GET',
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['order.catalog.read'],
          requestId: 'req-retry',
        },
      }),
    ).resolves.toEqual({ categories: ['a'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry failed mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter(2);
    await expect(
      adapter.execute({
        operation: 'partners-create',
        method: 'POST',
        idempotencyKey: 'idem-4',
        payload: { name: 'Acme', reason: 'Create partner for regression' },
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['order.partners.write'],
          requestId: 'req-no-retry',
        },
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after repeated destination failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter(0, 2);
    await expect(
      adapter.execute({
        operation: 'catalog-read',
        method: 'GET',
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['order.catalog.read'],
          requestId: 'req-circuit-1',
        },
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_UNAVAILABLE' });
    await expect(
      adapter.execute({
        operation: 'catalog-read',
        method: 'GET',
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['order.catalog.read'],
          requestId: 'req-circuit-2',
        },
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_UNAVAILABLE' });
    await expect(
      adapter.execute({
        operation: 'catalog-read',
        method: 'GET',
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['order.catalog.read'],
          requestId: 'req-circuit-3',
        },
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_CIRCUIT_OPEN' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
