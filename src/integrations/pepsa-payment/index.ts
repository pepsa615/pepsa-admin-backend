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
const PATH_PARAM_KEYS = ['platformId', 'userId', 'checkoutId'] as const;

type DestinationMethod = 'GET' | 'POST' | 'PATCH';
type Risk = PlatformCapabilities['operations'][number]['risk'];

type RouteDefinition = {
  key: string;
  adminMethod: 'GET' | 'POST';
  destinationMethod: DestinationMethod;
  path: string;
  permission: string;
  risk: Risk;
  mutation: boolean;
  retryable: boolean;
  async?: boolean;
};

const ROUTES: readonly RouteDefinition[] = Object.freeze([
  {
    key: 'platforms-list',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/v1/platforms',
    permission: 'payment.platforms.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'platforms-get',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/v1/platforms/{platformId}',
    permission: 'payment.platforms.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'platforms-onboard',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/v1/platforms',
    permission: 'payment.platforms.write',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'platforms-rotate-key',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/v1/platforms/{platformId}/rotate-key',
    permission: 'payment.platforms.keys.rotate',
    risk: 'critical',
    mutation: true,
    retryable: false,
  },
  {
    key: 'platforms-status',
    adminMethod: 'POST',
    destinationMethod: 'PATCH',
    path: '/v1/platforms/{platformId}/status',
    permission: 'payment.platforms.status',
    risk: 'critical',
    mutation: true,
    retryable: false,
  },
  {
    key: 'transfer-settings-get',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/v1/platforms/{platformId}/transfer-settings',
    permission: 'payment.settings.transfer',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'transfer-settings-patch',
    adminMethod: 'POST',
    destinationMethod: 'PATCH',
    path: '/v1/platforms/{platformId}/transfer-settings',
    permission: 'payment.settings.transfer',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'vas-settings-get',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/v1/platforms/{platformId}/vas-settings',
    permission: 'payment.settings.vas',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'vas-settings-patch',
    adminMethod: 'POST',
    destinationMethod: 'PATCH',
    path: '/v1/platforms/{platformId}/vas-settings',
    permission: 'payment.settings.vas',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'settlement-settings-get',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/v1/platforms/{platformId}/settlement-settings',
    permission: 'payment.settings.settlement',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'settlement-settings-patch',
    adminMethod: 'POST',
    destinationMethod: 'PATCH',
    path: '/v1/platforms/{platformId}/settlement-settings',
    permission: 'payment.settings.settlement',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'sva-provisioning-list',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/v1/admin/sva-provisioning',
    permission: 'payment.sva.provisioning.read',
    risk: 'medium',
    mutation: false,
    retryable: true,
  },
  {
    key: 'sva-provisioning-reconcile',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/v1/admin/sva-provisioning/{userId}/reconcile',
    permission: 'payment.sva.provisioning.reconcile',
    risk: 'critical',
    mutation: true,
    retryable: false,
  },
  {
    key: 'checkout-provisioning-list',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/v1/admin/checkout-provisioning',
    permission: 'payment.checkout.provisioning.read',
    risk: 'medium',
    mutation: false,
    retryable: true,
  },
  {
    key: 'checkout-provisioning-reconcile',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/v1/admin/checkout-provisioning/{checkoutId}/reconcile',
    permission: 'payment.checkout.provisioning.reconcile',
    risk: 'critical',
    mutation: true,
    retryable: false,
  },
  {
    key: 'kyc-rotate-encryption',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/v1/admin/kyc/rotate-encryption',
    permission: 'payment.kyc.encryption.rotate',
    risk: 'critical',
    mutation: true,
    retryable: false,
  },
]);

const ROUTE_BY_KEY = new Map(ROUTES.map((route) => [route.key, route]));

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

function collectParams(
  query: URLSearchParams | undefined,
  payload: Record<string, unknown> | undefined,
) {
  const params: Record<string, string> = {};
  for (const key of PATH_PARAM_KEYS) {
    const fromQuery = query?.get(key);
    const fromPayload = payload?.[key];
    const value =
      fromQuery ??
      (typeof fromPayload === 'string' || typeof fromPayload === 'number'
        ? String(fromPayload)
        : undefined);
    if (value) params[key] = value;
  }
  return params;
}

function resolvePath(template: string, params: Record<string, string>) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (!value)
      throw new AppError(422, 'OPERATION_PATH_PARAM_REQUIRED', `Missing path parameter ${key}`);
    return encodeURIComponent(value);
  });
}

function buildBody(
  route: RouteDefinition,
  payload: Record<string, unknown> | undefined,
  params: Record<string, string>,
  reason: string | undefined,
) {
  if (route.destinationMethod === 'GET') return undefined;
  const body: Record<string, unknown> = { ...(payload ?? {}) };
  delete body.reason;
  for (const key of PATH_PARAM_KEYS) {
    if (route.path.includes(`{${key}}`)) delete body[key];
  }
  for (const key of Object.keys(params)) {
    if (route.path.includes(`{${key}}`)) delete body[key];
  }
  // Destination SVA reconcile requires note (5–500); map control-plane reason when omitted.
  if (route.key === 'sva-provisioning-reconcile' && typeof body.note !== 'string' && reason) {
    body.note = reason;
  }
  if (route.key === 'checkout-provisioning-reconcile' && typeof body.note !== 'string' && reason) {
    body.note = reason;
  }
  return Object.keys(body).length ? JSON.stringify(body) : undefined;
}

function buildQueryString(
  route: RouteDefinition,
  query: URLSearchParams | undefined,
  params: Record<string, string>,
) {
  if (!query?.size) return '';
  const forwarded = new URLSearchParams();
  for (const [key, value] of query.entries()) {
    if (
      PATH_PARAM_KEYS.includes(key as (typeof PATH_PARAM_KEYS)[number]) &&
      route.path.includes(`{${key}}`)
    )
      continue;
    if (params[key] && route.path.includes(`{${key}}`)) continue;
    forwarded.append(key, value);
  }
  const serialized = forwarded.toString();
  return serialized ? `?${serialized}` : '';
}

export class PepsaPaymentAdapter implements PlatformAdapter {
  readonly key = 'pepsa-payment';
  readonly displayName = 'Pepsa Payment';
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
      await this.request(
        ROUTES.find((route) => route.key === 'sva-provisioning-list')!,
        {
          operation: 'sva-provisioning-list',
          method: 'GET',
          actor: {
            actorId: 'system',
            platformId,
            permissions: ['payment.sva.provisioning.read'],
            requestId: randomUUID(),
          },
        },
      );
      return { status: 'available', checkedAt };
    } catch {
      return { status: 'unavailable', checkedAt };
    }
  }

  async capabilities(_platformId: string): Promise<PlatformCapabilities> {
    if (this.capabilitiesCache && this.capabilitiesCache.expiresAt > Date.now())
      return this.capabilitiesCache.value;
    const value: PlatformCapabilities = {
      version: '1',
      operations: ROUTES.map((route) => ({
        key: route.key,
        method: route.adminMethod,
        permission: route.permission,
        risk: route.risk,
        ...(route.async ? { async: true } : {}),
      })),
    };
    this.capabilitiesCache = { value, expiresAt: Date.now() + capabilitiesTtlMs };
    return value;
  }

  async execute<T>(request: PlatformOperationRequest): Promise<T> {
    const route = ROUTE_BY_KEY.get(request.operation);
    if (!route)
      throw new AppError(
        404,
        'OPERATION_UNKNOWN',
        `Unknown payment operation ${request.operation}`,
      );
    if (request.method !== route.adminMethod)
      throw new AppError(
        405,
        'OPERATION_METHOD_MISMATCH',
        `Operation ${route.key} requires ${route.adminMethod}`,
      );
    return this.request<T>(route, request);
  }

  private async request<T>(
    route: RouteDefinition,
    operation: PlatformOperationRequest,
  ): Promise<T> {
    const requestId = operation.actor.requestId ?? randomUUID();
    if (this.openUntil > Date.now())
      throw new AppError(503, 'PLATFORM_CIRCUIT_OPEN', 'Pepsa Payment is temporarily unavailable');

    const params = collectParams(operation.query, operation.payload);
    const path = `${resolvePath(route.path, params)}${buildQueryString(route, operation.query, params)}`;
    const reason =
      typeof operation.payload?.reason === 'string' ? operation.payload.reason.trim() : undefined;
    if (route.mutation && (!reason || reason.length < 3))
      throw new AppError(
        422,
        'OPERATION_CONTEXT_REQUIRED',
        'Payment mutations require a change reason',
      );
    if (route.mutation && !operation.idempotencyKey)
      throw new AppError(
        422,
        'OPERATION_CONTEXT_REQUIRED',
        'Payment mutations require an idempotency key',
      );

    const body = buildBody(route, operation.payload, params, reason);
    const retryable = route.retryable;
    const attempts = retryable ? this.retryAttempts + 1 : 1;
    let response: Response | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const permissions =
          operation.actor.permissions.length > 0 ? operation.actor.permissions : [route.permission];
        const token = signActorContext(
          {
            iss: 'pepsa-admin',
            aud: this.audience,
            sub: operation.actor.actorId,
            platform: this.key,
            platformId: operation.actor.platformId,
            permissions,
            requestId,
            environmentId: operation.actor.environmentId,
            environment: operation.actor.environment,
            resourceScopes: operation.actor.resourceScopes,
            jti: randomUUID(),
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 60,
          },
          this.signingSecret,
        );
        response = await fetch(new URL(path, this.baseUrl), {
          method: route.destinationMethod,
          body,
          headers: {
            accept: 'application/json',
            ...(body ? { 'content-type': 'application/json' } : {}),
            authorization: `Bearer ${token}`,
            'x-request-id': requestId,
            ...(route.mutation
              ? {
                  'x-operator-id': operation.actor.actorId,
                  'x-change-reason': reason!,
                  'idempotency-key': operation.idempotencyKey!,
                }
              : operation.idempotencyKey
                ? { 'idempotency-key': operation.idempotencyKey }
                : {}),
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
      throw new AppError(503, 'PLATFORM_UNAVAILABLE', 'Pepsa Payment is unavailable', {
        cause: lastError instanceof Error ? lastError.name : 'network',
      });
    }

    this.failures = 0;
    this.openUntil = 0;

    const parsed = (await response.json().catch(() => ({}))) as {
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
        'Pepsa Payment rejected a control-plane request',
      );
      throw new AppError(
        response.status >= 500 ? 502 : response.status,
        parsed.error?.code ??
          (response.status === 429 ? 'PLATFORM_RATE_LIMITED' : 'PLATFORM_ERROR'),
        parsed.error?.message ??
          (response.status === 429
            ? 'Pepsa Payment is temporarily rate limited. Try again shortly.'
            : 'Platform request failed'),
        response.status === 429 ? { retryAfter } : undefined,
      );
    }
    return (parsed.data ?? parsed) as T;
  }
}

export const pepsaPaymentRouteCatalogue = ROUTES;
