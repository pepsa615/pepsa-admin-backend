import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverIdentityToken } from './identity-delivery.js';

afterEach(() => vi.unstubAllGlobals());

const input = {
  email: 'admin@example.com',
  token: 'single-use-token',
  purpose: 'admin-invitation' as const,
  expiresInMinutes: 60,
  requestId: 'request-id',
  failureCode: 'DELIVERY_FAILED',
  failureMessage: 'Delivery failed',
};

describe('identity token delivery', () => {
  it('is disabled without a configured trusted delivery service', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(deliverIdentityToken(undefined, input)).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends purpose-bound tokens to the configured service', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      deliverIdentityToken(
        { url: 'https://identity.example.test/deliver', token: 'service-token' },
        input,
      ),
    ).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://identity.example.test/deliver',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('admin-invitation'),
      }),
    );
  });

  it('normalizes delivery failures without exposing the token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(
      deliverIdentityToken(
        { url: 'https://identity.example.test/deliver', token: 'service-token' },
        input,
      ),
    ).rejects.toMatchObject({ code: 'DELIVERY_FAILED', message: 'Delivery failed' });
  });
});
