import { randomUUID } from 'node:crypto';
import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformHealth,
  PlatformOperationRequest,
} from '../adapter.js';
import { signActorContext } from '../../core/crypto.js';
import { AppError } from '../../core/errors.js';

type VendorRoute = {
  key: string;
  method: 'GET' | 'POST';
  permission: string;
  risk: PlatformCapabilities['operations'][number]['risk'];
  retryable: boolean;
  requiresApproval: boolean;
  timeoutClass: 'read' | 'mutation';
};

export const vendorRouteCatalogue: readonly VendorRoute[] = Object.freeze(
  [
    ['overview-read', 'GET', 'vendor.dashboard.read', 'low'],
    ['vendors-list', 'GET', 'vendor.businesses.read', 'medium'],
    ['vendors-detail', 'GET', 'vendor.businesses.read', 'medium'],
    ['operations-read', 'GET', 'vendor.operations.read', 'medium'],
    ['performance-read', 'GET', 'vendor.performance.read', 'medium'],
    ['correlation-search', 'GET', 'vendor.operations.read', 'high'],
    ['operational-health-read', 'GET', 'vendor.exceptions.operate', 'high'],
    ['finance-read', 'GET', 'vendor.finance.read', 'high'],
    ['exceptions-read', 'GET', 'vendor.exceptions.operate', 'high'],
    ['audit-read', 'GET', 'vendor.audit.read', 'medium'],
    ['reviews-read', 'GET', 'vendor.businesses.read', 'medium'],
    ['vendor-application-detail', 'GET', 'vendor.businesses.review', 'high'],
    ['vendor-application-document', 'GET', 'vendor.businesses.review', 'high'],
    ['vendor-application-review', 'POST', 'vendor.businesses.review', 'high'],
    ['dispatchers-read', 'GET', 'vendor.dispatchers.review', 'high'],
    ['dispatcher-review-detail', 'GET', 'vendor.dispatchers.review', 'high'],
    ['dispatcher-review-document', 'GET', 'vendor.dispatchers.review', 'high'],
    ['dispatcher-review', 'POST', 'vendor.dispatchers.review', 'high'],
    ['rider-provisioning-list', 'GET', 'vendor.dispatchers.review', 'high'],
    ['rider-provisioning-retry', 'POST', 'vendor.dispatchers.review', 'high'],
    ['provisioning-list', 'GET', 'vendor.integrations.payment.read', 'medium'],
    ['fee-policies-list', 'GET', 'vendor.fees.read', 'medium'],
    ['fee-policy-simulate', 'POST', 'vendor.fees.read', 'medium'],
    ['fee-report', 'GET', 'vendor.finance.read', 'high'],
    ['exception-resolve', 'POST', 'vendor.exceptions.operate', 'high'],
    ['delivery-replay', 'POST', 'vendor.exceptions.operate', 'high'],
    ['vendor-suspend', 'POST', 'vendor.businesses.status', 'critical'],
    ['vendor-reactivate', 'POST', 'vendor.businesses.status', 'critical'],
    ['vendor-dispatch-freeze', 'POST', 'vendor.businesses.status', 'critical'],
    ['vendor-dispatch-unfreeze', 'POST', 'vendor.businesses.status', 'critical'],
    ['sessions-revoke', 'POST', 'vendor.businesses.status', 'critical'],
    ['provisioning-retry', 'POST', 'vendor.integrations.payment.manage', 'critical'],
    ['fee-policy-create', 'POST', 'vendor.fees.manage', 'critical'],
    ['fee-policy-activate', 'POST', 'vendor.fees.manage', 'critical'],
    ['fee-policy-retire', 'POST', 'vendor.fees.manage', 'critical'],
    ['fee-assessment-adjust', 'POST', 'vendor.fees.manage', 'critical'],
  ].map(([key, method, permission, risk]) => ({
    key,
    method,
    permission,
    risk,
    retryable: method === 'GET',
    requiresApproval: risk === 'critical',
    timeoutClass: method === 'GET' ? 'read' : 'mutation',
  })),
) as readonly VendorRoute[];

export class VendorAdapter implements PlatformAdapter {
  readonly key = 'vendor';
  readonly displayName = 'Vendor';
  private failures = 0;
  private openUntil = 0;
  private capabilitiesCache?: { value: PlatformCapabilities; expiresAt: number };

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
      const result = await this.request<{ status: string }>(
        '/internal/admin/v1/health',
        { method: 'GET' },
        this.systemOperation(platformId),
      );
      return { status: result.status === 'available' ? 'available' : 'degraded', checkedAt };
    } catch {
      return { status: 'unavailable', checkedAt };
    }
  }

  async capabilities(platformId: string): Promise<PlatformCapabilities> {
    if (this.capabilitiesCache && this.capabilitiesCache.expiresAt > Date.now())
      return this.capabilitiesCache.value;
    const value = await this.request<PlatformCapabilities>(
      '/internal/admin/v1/platform-capabilities',
      { method: 'GET' },
      this.systemOperation(platformId),
    );
    const expected = new Map(vendorRouteCatalogue.map((route) => [route.key, route]));
    for (const operation of value.operations) {
      const route = expected.get(operation.key);
      if (
        !route ||
        route.method !== operation.method ||
        route.permission !== operation.permission ||
        route.risk !== operation.risk
      )
        throw new AppError(
          502,
          'PLATFORM_CONTRACT_MISMATCH',
          'Vendor capability contract mismatch',
        );
    }
    if (value.operations.length !== vendorRouteCatalogue.length)
      throw new AppError(
        502,
        'PLATFORM_CONTRACT_MISMATCH',
        'Vendor capability catalogue incomplete',
      );
    this.capabilitiesCache = { value, expiresAt: Date.now() + 30_000 };
    return value;
  }

  execute<T>(operation: PlatformOperationRequest): Promise<T> {
    const route = vendorRouteCatalogue.find(({ key }) => key === operation.operation);
    if (!route)
      throw new AppError(404, 'OPERATION_NOT_SUPPORTED', 'Vendor operation is not supported');
    if (route.method !== operation.method)
      throw new AppError(405, 'OPERATION_METHOD_INVALID', 'Vendor operation method is invalid');
    if (!operation.actor.permissions.includes(route.permission))
      throw new AppError(403, 'PERMISSION_DENIED', `${route.permission} permission required`);
    if (route.requiresApproval && (!operation.actor.mfaVerified || !operation.actor.approvalId))
      throw new AppError(
        403,
        'APPROVAL_REQUIRED',
        'Recent MFA and approved dual control are required',
      );
    const query = operation.query?.size ? `?${operation.query}` : '';
    return this.request<T>(
      `/internal/admin/v1/operations/${encodeURIComponent(operation.operation)}${query}`,
      {
        method: operation.method,
        body: operation.payload ? JSON.stringify(operation.payload) : undefined,
      },
      operation,
    );
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
        environment: process.env.DEPLOYMENT_ENVIRONMENT ?? 'production',
      },
    };
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    operation: PlatformOperationRequest,
  ): Promise<T> {
    if (this.openUntil > Date.now())
      throw new AppError(503, 'PLATFORM_CIRCUIT_OPEN', 'Vendor is temporarily unavailable');
    const route = vendorRouteCatalogue.find(({ key }) => key === operation.operation);
    const retryable = route?.retryable === true;
    const attempts = retryable ? this.retryAttempts + 1 : 1;
    let response: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const token = signActorContext(
          {
            iss: 'pepsa-admin',
            aud: this.audience,
            sub: operation.actor.actorId,
            platform: this.key,
            platformId: operation.actor.platformId,
            permissions: operation.actor.permissions,
            requestId: operation.actor.requestId,
            environmentId: operation.actor.environmentId,
            environment: operation.actor.environment,
            resourceScopes: operation.actor.resourceScopes,
            mfaVerified: operation.actor.mfaVerified,
            approvalId: operation.actor.approvalId,
            jti: randomUUID(),
            iat: Math.floor(Date.now() / 1_000),
            exp: Math.floor(Date.now() / 1_000) + 60,
          },
          this.signingSecret,
        );
        response = await fetch(new URL(path, this.baseUrl), {
          ...init,
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            'x-request-id': operation.actor.requestId,
            ...(operation.idempotencyKey ? { 'idempotency-key': operation.idempotencyKey } : {}),
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.status < 500 && ![408, 425, 429].includes(response.status)) break;
      } catch (error) {
        lastError = error;
      }
      if (attempt + 1 < attempts)
        await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, 100 * 2 ** attempt)));
    }
    if (!response || response.status >= 500) {
      this.failures += 1;
      if (this.failures >= this.circuitFailureThreshold) {
        this.openUntil = Date.now() + this.circuitOpenMs;
        this.failures = 0;
      }
      throw new AppError(503, 'PLATFORM_UNAVAILABLE', 'Vendor is unavailable', {
        cause: lastError instanceof Error ? lastError.message : 'upstream',
        requestId: operation.actor.requestId,
      });
    }
    this.failures = 0;
    this.openUntil = 0;
    const body = (await response.json().catch(() => ({}))) as {
      data?: T;
      error?: { code?: string; message?: string };
    };
    if (!response.ok)
      throw new AppError(
        response.status,
        body.error?.code ?? 'PLATFORM_ERROR',
        body.error?.message ?? 'Vendor request failed',
      );
    return (body.data ?? body) as T;
  }
}
