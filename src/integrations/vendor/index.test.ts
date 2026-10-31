import { afterEach, describe, expect, it, vi } from 'vitest';
import { VendorAdapter, vendorRouteCatalogue } from './index.js';

const adapter = (retries = 1) =>
  new VendorAdapter(
    'https://vendor.example',
    1_000,
    'pepsa-vendor-admin',
    'long-signing-secret',
    retries,
  );

const actor = {
  actorId: 'admin-1',
  platformId: 'platform-1',
  permissions: ['vendor.businesses.read'],
  requestId: 'request-1',
  environment: 'staging',
};

describe('VendorAdapter contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a complete explicit operation policy catalogue', () => {
    expect(vendorRouteCatalogue).toHaveLength(36);
    expect(vendorRouteCatalogue.find(({ key }) => key === 'vendor-suspend')).toMatchObject({
      method: 'POST',
      permission: 'vendor.businesses.status',
      risk: 'critical',
      retryable: false,
      requiresApproval: true,
    });
  });

  it('rejects undeclared operations and method drift before network access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      Promise.resolve().then(() =>
        adapter().execute({ operation: 'unknown', method: 'GET', actor }),
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_NOT_SUPPORTED' });
    await expect(
      Promise.resolve().then(() =>
        adapter().execute({ operation: 'vendors-list', method: 'POST', actor }),
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_METHOD_INVALID' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends signed, correlated and environment-scoped reads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { items: [] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      adapter().execute({ operation: 'vendors-list', method: 'GET', actor }),
    ).resolves.toEqual({ items: [] });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-request-id']).toBe('request-1');
    const claims = JSON.parse(
      Buffer.from(headers.authorization!.split('.')[1]!, 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(claims).toMatchObject({
      aud: 'pepsa-vendor-admin',
      platform: 'vendor',
      environment: 'staging',
      requestId: 'request-1',
    });
  });

  it('requires permission, MFA and approval for critical mutations', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      Promise.resolve().then(() =>
        adapter().execute({
          operation: 'vendor-suspend',
          method: 'POST',
          actor: { ...actor, permissions: ['vendor.businesses.status'] },
          idempotencyKey: 'idem-1',
        }),
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry mutations even when idempotent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      adapter(2).execute({
        operation: 'vendor-suspend',
        method: 'POST',
        actor: {
          ...actor,
          permissions: ['vendor.businesses.status'],
          mfaVerified: true,
          approvalId: 'approval-1',
        },
        idempotencyKey: 'idem-1',
        payload: { vendorId: 'vendor-1', reason: 'Confirmed risk response' },
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
