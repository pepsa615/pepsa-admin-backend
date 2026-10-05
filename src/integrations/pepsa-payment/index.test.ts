import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../core/errors.js';
import { PepsaPaymentAdapter, pepsaPaymentRouteCatalogue } from './index.js';

function createAdapter(retries = 1, circuitThreshold = 5) {
  return new PepsaPaymentAdapter(
    'https://payment.example',
    1000,
    'pepsa-payment',
    'signing-secret-long-enough',
    retries,
    circuitThreshold,
    30_000,
  );
}

describe('PepsaPaymentAdapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exposes the Phase 0 capability catalogue', async () => {
    const adapter = createAdapter();
    const capabilities = await adapter.capabilities('platform-id');
    expect(capabilities.version).toBe('1');
    expect(capabilities.operations.map((op) => op.key)).toEqual(
      pepsaPaymentRouteCatalogue.map((route) => route.key),
    );
    expect(capabilities.operations.find((op) => op.key === 'transfer-settings-get')).toMatchObject(
      {
        method: 'GET',
        permission: 'payment.settings.transfer',
        risk: 'low',
      },
    );
    expect(capabilities.operations.find((op) => op.key === 'platforms-rotate-key')).toMatchObject({
      method: 'POST',
      permission: 'payment.platforms.keys.rotate',
      risk: 'critical',
    });
    expect(capabilities.operations.find((op) => op.key === 'platforms-status')).toMatchObject({
      method: 'POST',
      permission: 'payment.platforms.status',
      risk: 'critical',
    });
    expect(capabilities.operations).toHaveLength(14);
  });

  it('probes SVA provisioning list for platform availability', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter();
    await expect(adapter.checkHealth('platform-id')).resolves.toMatchObject({
      status: 'available',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://payment.example/v1/admin/sva-provisioning',
    );
  });

  it('sends a signed actor token for settings reads with correlated request id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ enabled: true, maxAmount: 1000 }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter();
    await expect(
      adapter.execute({
        operation: 'transfer-settings-get',
        method: 'GET',
        query: new URLSearchParams({ platformId: 'plat-1' }),
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['payment.settings.transfer'],
          requestId: 'req-settings',
        },
      }),
    ).resolves.toEqual({ enabled: true, maxAmount: 1000 });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://payment.example/v1/platforms/plat-1/transfer-settings',
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-request-id']).toBe('req-settings');
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
      aud: 'pepsa-payment',
      platform: 'pepsa-payment',
      permissions: ['payment.settings.transfer'],
      requestId: 'req-settings',
    });
    expect(headers['x-operator-id']).toBeUndefined();
  });

  it('propagates mutation attribution headers for key rotate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ apiKey: 'pp_live_rotated' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter();
    await expect(
      adapter.execute({
        operation: 'platforms-rotate-key',
        method: 'POST',
        idempotencyKey: 'idem-rotate',
        payload: {
          platformId: 'plat-1',
          reason: 'Scheduled quarterly platform API key rotation',
        },
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['payment.platforms.keys.rotate'],
          requestId: 'req-rotate',
        },
      }),
    ).resolves.toEqual({ apiKey: 'pp_live_rotated' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://payment.example/v1/platforms/plat-1/rotate-key',
    );
    expect(init.method).toBe('POST');
    expect(headers['x-operator-id']).toBe('admin-1');
    expect(headers['x-change-reason']).toBe('Scheduled quarterly platform API key rotation');
    expect(headers['x-request-id']).toBe('req-rotate');
    expect(headers['idempotency-key']).toBe('idem-rotate');
    expect(init.body).toBeUndefined();
  });

  it('maps platforms-status to destination PATCH and substitutes path params', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'SUSPENDED' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter();
    await adapter.execute({
      operation: 'platforms-status',
      method: 'POST',
      idempotencyKey: 'idem-status',
      payload: {
        platformId: 'plat-uuid',
        status: 'SUSPENDED',
        reason: 'Suspend platform after fraud review',
      },
      actor: {
        actorId: 'admin-1',
        platformId: 'platform-id',
        permissions: ['payment.platforms.status'],
        requestId: 'req-patch',
      },
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://payment.example/v1/platforms/plat-uuid/status',
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('PATCH');
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      status: 'SUSPENDED',
    });
  });

  it('maps control-plane reason to SVA reconcile note when note is omitted', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter();
    await adapter.execute({
      operation: 'sva-provisioning-reconcile',
      method: 'POST',
      idempotencyKey: 'idem-sva',
      payload: {
        userId: 'user-1',
        action: 'retry',
        reason: 'Retry failed SVA provisioning after provider outage',
      },
      actor: {
        actorId: 'admin-1',
        platformId: 'platform-id',
        permissions: ['payment.sva.provisioning.reconcile'],
        requestId: 'req-sva',
      },
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://payment.example/v1/admin/sva-provisioning/user-1/reconcile',
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      action: 'retry',
      note: 'Retry failed SVA provisioning after provider outage',
    });
  });

  it('fails closed when required path params are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter();
    await expect(
      adapter.execute({
        operation: 'platforms-rotate-key',
        method: 'POST',
        idempotencyKey: 'idem-missing',
        payload: { reason: 'Rotate compromised platform key' },
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['payment.platforms.keys.rotate'],
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
        new Response(JSON.stringify({ data: { items: [] } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter(1);
    await expect(
      adapter.execute({
        operation: 'sva-provisioning-list',
        method: 'GET',
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['payment.sva.provisioning.read'],
          requestId: 'req-retry',
        },
      }),
    ).resolves.toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry failed mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapter(2);
    await expect(
      adapter.execute({
        operation: 'platforms-rotate-key',
        method: 'POST',
        idempotencyKey: 'idem-no-retry',
        payload: {
          platformId: 'plat-1',
          reason: 'Rotate key after suspected leak',
        },
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['payment.platforms.keys.rotate'],
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
        operation: 'sva-provisioning-list',
        method: 'GET',
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['payment.sva.provisioning.read'],
          requestId: 'req-circuit-1',
        },
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_UNAVAILABLE' });
    await expect(
      adapter.execute({
        operation: 'sva-provisioning-list',
        method: 'GET',
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['payment.sva.provisioning.read'],
          requestId: 'req-circuit-2',
        },
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_UNAVAILABLE' });
    await expect(
      adapter.execute({
        operation: 'sva-provisioning-list',
        method: 'GET',
        actor: {
          actorId: 'admin-1',
          platformId: 'platform-id',
          permissions: ['payment.sva.provisioning.read'],
          requestId: 'req-circuit-3',
        },
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_CIRCUIT_OPEN' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
