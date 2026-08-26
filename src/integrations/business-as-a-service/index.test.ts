import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessAsAServiceAdapter } from './index.js';

describe('BAS adapter resilience', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('includes the platform context in signed system requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { version: '1', operations: [] } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new BusinessAsAServiceAdapter(
      'https://bas.example',
      1000,
      'bas-audience',
      'signing-secret-long-enough',
    );

    await adapter.capabilities('platform-id');

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const token = headers.authorization!.replace(/^Bearer /, '');
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
      platformId?: string;
      sub?: string;
    };
    expect(payload).toMatchObject({ platformId: 'platform-id', sub: 'system' });
  });

  it('retries idempotent calls and forwards a signed narrow actor context', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new BusinessAsAServiceAdapter(
      'https://bas.example',
      1000,
      'bas-audience',
      'signing-secret-long-enough',
      1,
    );
    await expect(
      adapter.execute({
        operation: 'review',
        method: 'POST',
        idempotencyKey: 'key',
        payload: {},
        actor: {
          actorId: 'actor',
          platformId: 'platform',
          permissions: ['bas.review'],
          requestId: 'request-id',
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
    expect(headers.authorization).not.toBe(firstHeaders.authorization);
    expect(headers['idempotency-key']).toBe('key');
  });

  it('coalesces and briefly caches concurrent capability requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { version: '1', operations: [] } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new BusinessAsAServiceAdapter(
      'https://bas.example',
      1000,
      'bas-audience',
      'signing-secret-long-enough',
    );

    const [first, second] = await Promise.all([
      adapter.capabilities('platform-id'),
      adapter.capabilities('platform-id'),
    ]);
    const cached = await adapter.capabilities('platform-id');

    expect(first).toEqual(second);
    expect(cached).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient platform rate limit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Too Many Requests', {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { version: '1', operations: [] } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new BusinessAsAServiceAdapter(
      'https://bas.example',
      1000,
      'bas-audience',
      'signing-secret-long-enough',
      1,
    );

    await expect(adapter.capabilities('platform-id')).resolves.toMatchObject({ version: '1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
