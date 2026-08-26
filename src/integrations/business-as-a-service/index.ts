import { randomUUID } from 'node:crypto';
import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformHealth,
  PlatformOperationRequest,
} from '../adapter.js';
import { signActorContext } from '../../core/crypto.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

const capabilitiesTtlMs = 30_000;

function retryDelay(response: Response | undefined, attempt: number) {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds)
      ? seconds * 1_000
      : new Date(retryAfter).getTime() - Date.now();
    if (Number.isFinite(delay)) return Math.max(100, Math.min(5_000, delay));
  }
  return Math.min(1_000, 100 * 2 ** attempt);
}

export class BusinessAsAServiceAdapter implements PlatformAdapter {
  readonly key = 'business-as-a-service';
  readonly displayName = 'Business as a Service';
  private failures = 0;
  private openUntil = 0;
  private capabilitiesCache?: { value: PlatformCapabilities; expiresAt: number };
  private capabilitiesRequest?: Promise<PlatformCapabilities>;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly audience: string,
    private readonly signingSecret: string,
    private readonly retryAttempts = 2,
    private readonly circuitFailureThreshold = 5,
    private readonly circuitOpenMs = 30_000,
  ) {}

  async checkHealth(platformId: string): Promise<PlatformHealth> {
    const checkedAt = new Date().toISOString();

    try {
      const response = await this.request<{ status: string }>(
        '/internal/admin/v1/health',
        { method: 'GET' },
        this.systemOperation(platformId),
      );
      return {
        status: response.status === 'available' ? 'available' : 'degraded',
        checkedAt,
      };
    } catch {
      return { status: 'unavailable', checkedAt };
    }
  }

  async capabilities(platformId: string): Promise<PlatformCapabilities> {
    if (this.capabilitiesCache && this.capabilitiesCache.expiresAt > Date.now())
      return this.capabilitiesCache.value;
    if (this.capabilitiesRequest) return this.capabilitiesRequest;

    const pending = this.request<PlatformCapabilities>(
      '/internal/admin/v1/capabilities',
      { method: 'GET' },
      this.systemOperation(platformId),
    );
    this.capabilitiesRequest = pending;
    try {
      const value = await pending;
      this.capabilitiesCache = { value, expiresAt: Date.now() + capabilitiesTtlMs };
      return value;
    } finally {
      if (this.capabilitiesRequest === pending) this.capabilitiesRequest = undefined;
    }
  }

  private systemOperation(platformId: string): PlatformOperationRequest {
    return {
      operation: 'platform-metadata',
      method: 'GET',
      actor: {
        actorId: 'system',
        platformId,
        permissions: [],
        requestId: randomUUID(),
      },
    };
  }

  async execute<T>(request: PlatformOperationRequest): Promise<T> {
    const path = `/internal/admin/v1/operations/${encodeURIComponent(request.operation)}${request.query?.size ? `?${request.query}` : ''}`;
    return this.request<T>(
      path,
      {
        method: request.method,
        body: request.payload ? JSON.stringify(request.payload) : undefined,
      },
      request,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    operation?: PlatformOperationRequest,
  ): Promise<T> {
    const requestId = operation?.actor.requestId ?? randomUUID();
    if (this.openUntil > Date.now())
      throw new AppError(
        503,
        'PLATFORM_CIRCUIT_OPEN',
        'Business as a Service is temporarily unavailable',
      );
    const retryable = init.method === 'GET' || Boolean(operation?.idempotencyKey);
    const attempts = retryable ? this.retryAttempts + 1 : 1;
    let response: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const token = signActorContext(
          {
            iss: 'pepsa-admin',
            aud: this.audience,
            sub: operation?.actor.actorId ?? 'system',
            platform: this.key,
            platformId: operation?.actor.platformId,
            permissions: operation?.actor.permissions ?? [],
            requestId,
            environmentId: operation?.actor.environmentId,
            resourceScopes: operation?.actor.resourceScopes,
            jti: randomUUID(),
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 60,
          },
          this.signingSecret,
        );
        response = await fetch(new URL(path, this.baseUrl), {
          ...init,
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            'x-request-id': requestId,
            ...(operation?.idempotencyKey ? { 'idempotency-key': operation.idempotencyKey } : {}),
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (![408, 425, 429].includes(response.status) && response.status < 500) break;
        lastError = new Error(`Destination returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      if (attempt + 1 < attempts)
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
    }
    if (!response || response.status >= 500) {
      this.failures += 1;
      if (this.failures >= this.circuitFailureThreshold) {
        this.openUntil = Date.now() + this.circuitOpenMs;
        this.failures = 0;
      }
      throw new AppError(503, 'PLATFORM_UNAVAILABLE', 'Business as a Service is unavailable', {
        cause: lastError instanceof Error ? lastError.name : 'network',
      });
    }
    this.failures = 0;
    this.openUntil = 0;
    const body = (await response.json().catch(() => ({}))) as {
      data?: T;
      error?: { code?: string; message?: string };
    };
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after') ?? undefined;
      logger.warn(
        {
          event: 'PLATFORM_REQUEST_REJECTED',
          platform: this.key,
          upstreamOrigin: new URL(this.baseUrl).origin,
          path,
          status: response.status,
          contentType: response.headers.get('content-type'),
          retryAfter,
          upstreamRequestId: response.headers.get('x-request-id'),
          requestId,
        },
        'Business as a Service rejected a control-plane request',
      );
      throw new AppError(
        response.status >= 500 ? 502 : response.status,
        body.error?.code ?? (response.status === 429 ? 'PLATFORM_RATE_LIMITED' : 'PLATFORM_ERROR'),
        body.error?.message ??
          (response.status === 429
            ? 'Business as a Service is temporarily rate limited. Try again shortly.'
            : 'Platform request failed'),
        response.status === 429 ? { retryAfter } : undefined,
      );
    }
    return (body.data ?? body) as T;
  }
}
