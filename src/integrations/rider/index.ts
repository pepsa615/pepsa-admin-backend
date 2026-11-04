import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformHealth,
  PlatformOperationRequest,
} from '../adapter.js';
import { AppError } from '../../core/errors.js';

type Route = {
  key: string;
  method: 'GET' | 'POST';
  path: string;
  permission: string;
  risk: PlatformCapabilities['operations'][number]['risk'];
};

const routes: readonly Route[] = [
  { key: 'wallet-provisioning-list', method: 'GET', path: '/v1/internal/wallet-provisioning', permission: 'rider.provisioning.read', risk: 'high' },
  { key: 'wallet-provisioning-reconcile', method: 'POST', path: '/v1/internal/wallet-provisioning/{jobId}/reconcile', permission: 'rider.provisioning.manage', risk: 'critical' },
  { key: 'insurance-claims-list', method: 'GET', path: '/v1/internal/insurance/claims', permission: 'rider.insurance.read', risk: 'high' },
  { key: 'insurance-claim-review', method: 'POST', path: '/v1/internal/insurance/claims/{claimId}/review', permission: 'rider.insurance.manage', risk: 'critical' },
  { key: 'onboarding-documents-list', method: 'GET', path: '/v1/internal/onboarding/documents', permission: 'rider.onboarding.read', risk: 'medium' },
  { key: 'onboarding-document-get', method: 'GET', path: '/v1/internal/onboarding/documents/{documentKey}', permission: 'rider.onboarding.read', risk: 'medium' },
  { key: 'onboarding-document-save', method: 'POST', path: '/v1/internal/onboarding/documents/{documentKey}', permission: 'rider.onboarding.manage', risk: 'high' },
];

export class RiderAdapter implements PlatformAdapter {
  readonly key = 'rider';
  readonly displayName = 'Rider';

  constructor(
    private readonly baseUrl: string,
    private readonly apiToken: string,
    private readonly timeoutMs: number,
  ) {}

  async checkHealth(_platformId: string): Promise<PlatformHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return { status: response.ok ? 'available' : 'degraded', checkedAt };
    } catch {
      return { status: 'unavailable', checkedAt };
    }
  }

  async capabilities(_platformId: string): Promise<PlatformCapabilities> {
    return {
      version: '1.0.0',
      operations: routes.map(({ key, method, permission, risk }) => ({ key, method, permission, risk })),
    };
  }

  async execute<T>(operation: PlatformOperationRequest): Promise<T> {
    const route = routes.find((item) => item.key === operation.operation);
    if (!route) throw new AppError(404, 'OPERATION_NOT_SUPPORTED', 'Rider operation is not supported');
    if (route.method !== operation.method)
      throw new AppError(405, 'OPERATION_METHOD_INVALID', 'Rider operation method is invalid');
    if (!operation.actor.permissions.includes(route.permission))
      throw new AppError(403, 'PERMISSION_DENIED', `${route.permission} permission required`);
    if (route.risk === 'critical' && (!operation.actor.mfaVerified || !operation.actor.approvalId))
      throw new AppError(403, 'APPROVAL_REQUIRED', 'Recent MFA and approved dual control are required');

    const payload: Record<string, unknown> = { ...operation.payload, actorId: operation.actor.actorId };
    let path = route.path;
    for (const key of ['jobId', 'claimId', 'documentKey']) {
      const fromPayload = payload[key];
      const fromQuery = operation.query?.get(key);
      const value =
        typeof fromPayload === 'string' && fromPayload
          ? fromPayload
          : typeof fromQuery === 'string' && fromQuery
            ? fromQuery
            : undefined;
      if (value) {
        path = path.replace(`{${key}}`, encodeURIComponent(value));
        operation.query?.delete(key);
      }
    }
    if (path.includes('{')) throw new AppError(400, 'PATH_PARAMETER_REQUIRED', 'Rider resource identifier is required');
    const query = operation.query?.toString();
    const response = await fetch(`${this.baseUrl}${path}${query ? `?${query}` : ''}`, {
      method: route.method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        'X-Request-Id': operation.actor.requestId,
        'X-Admin-Permissions': operation.actor.permissions.join(','),
        'X-Admin-Actor-Id': operation.actor.actorId,
        ...(operation.idempotencyKey ? { 'Idempotency-Key': operation.idempotencyKey } : {}),
      },
      body: route.method === 'POST' ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch(() => {
      throw new AppError(502, 'RIDER_UNREACHABLE', 'Rider service is unavailable');
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new AppError(response.status, 'RIDER_OPERATION_FAILED', 'Rider operation failed', body);
    return body as T;
  }
}
