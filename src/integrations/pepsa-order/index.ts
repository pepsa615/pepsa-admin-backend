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
const PATH_PARAM_KEYS = [
  'partnerId',
  'costProfileId',
  'credentialId',
  'version',
  'runId',
  'batchId',
  'taskId',
  'refundId',
  'id',
] as const;

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
    key: 'partners-list',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/partners',
    permission: 'order.partners.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'partners-get',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/partners/{partnerId}',
    permission: 'order.partners.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'partners-create',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/partners',
    permission: 'order.partners.write',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'partners-update',
    adminMethod: 'POST',
    destinationMethod: 'PATCH',
    path: '/internal/v1/partners/{partnerId}',
    permission: 'order.partners.write',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'partners-users-create',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/partners/{partnerId}/users',
    permission: 'order.partners.write',
    risk: 'medium',
    mutation: true,
    retryable: false,
  },
  {
    key: 'cost-profiles-create',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/cost-profiles',
    permission: 'order.partners.write',
    risk: 'medium',
    mutation: true,
    retryable: false,
  },
  {
    key: 'partners-cost-profile-authorize',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/partners/{partnerId}/cost-profiles/{costProfileId}',
    permission: 'order.partners.write',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'credentials-issue',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/partners/{partnerId}/credentials',
    permission: 'order.credentials.issue',
    risk: 'critical',
    mutation: true,
    retryable: false,
  },
  {
    key: 'credentials-revoke',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/credentials/{credentialId}/revoke',
    permission: 'order.credentials.revoke',
    risk: 'critical',
    mutation: true,
    retryable: false,
  },
  {
    key: 'catalog-read',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/catalog',
    permission: 'order.catalog.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'fleet-health',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/fleet/health',
    permission: 'order.fleet.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'fleet-riders',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/fleet/riders',
    permission: 'order.fleet.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'fleet-evaluate',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/fleet/evaluate',
    permission: 'order.fleet.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'fleet-refresh',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/fleet/refresh',
    permission: 'order.fleet.sync',
    risk: 'medium',
    mutation: true,
    retryable: false,
  },
  {
    key: 'policies-active',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/operations/policies/active',
    permission: 'order.operations.policies.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'policies-version',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/operations/policies/{version}',
    permission: 'order.operations.policies.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'policies-publish',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/operations/policies',
    permission: 'order.operations.policies.write',
    risk: 'critical',
    mutation: true,
    retryable: false,
  },
  {
    key: 'processing-pool',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/processing/pool',
    permission: 'order.processing.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'processing-run-get',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/processing/runs/{runId}',
    permission: 'order.processing.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'processing-batch-get',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/processing/batches/{batchId}',
    permission: 'order.processing.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'processing-run-automatic',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/processing/runs/automatic',
    permission: 'order.processing.run',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'processing-run-optimize',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/processing/runs/optimize',
    permission: 'order.processing.run',
    risk: 'high',
    mutation: true,
    retryable: false,
    async: true,
  },
  {
    key: 'processing-run-manual',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/processing/runs/manual',
    permission: 'order.processing.manual',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'dispatch-tasks',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/dispatch/tasks',
    permission: 'order.dispatch.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'dispatch-task-get',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/dispatch/tasks/{taskId}',
    permission: 'order.dispatch.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'dispatch-offer',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/dispatch/tasks/{taskId}/offers',
    permission: 'order.dispatch.write',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'dispatch-refund-retry',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/dispatch/refunds/{refundId}/retry',
    permission: 'order.dispatch.refund',
    risk: 'critical',
    mutation: true,
    retryable: false,
  },
  {
    key: 'events-list',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/operations/events',
    permission: 'order.events.read',
    risk: 'medium',
    mutation: false,
    retryable: true,
  },
  {
    key: 'audits-list',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/operations/audits',
    permission: 'order.events.read',
    risk: 'medium',
    mutation: false,
    retryable: true,
  },
  {
    key: 'metrics-read',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/operations/metrics',
    permission: 'order.events.read',
    risk: 'medium',
    mutation: false,
    retryable: true,
  },
  {
    key: 'provider-failures',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/operations/provider-failures',
    permission: 'order.events.operate',
    risk: 'medium',
    mutation: false,
    retryable: true,
  },
  {
    key: 'webhook-replay',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/operations/webhook-deliveries/{id}/replay',
    permission: 'order.events.operate',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'notification-replay',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/operations/notification-deliveries/{id}/replay',
    permission: 'order.events.operate',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'bas-callbacks-provision',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/operations/bas-callbacks',
    permission: 'order.events.operate',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'integrations-list',
    adminMethod: 'GET',
    destinationMethod: 'GET',
    path: '/internal/v1/integrations',
    permission: 'order.integrations.read',
    risk: 'low',
    mutation: false,
    retryable: true,
  },
  {
    key: 'integrations-upsert',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/integrations',
    permission: 'order.integrations.write',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'integrations-disable',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/integrations/{id}/disable',
    permission: 'order.integrations.write',
    risk: 'high',
    mutation: true,
    retryable: false,
  },
  {
    key: 'integrations-rotate',
    adminMethod: 'POST',
    destinationMethod: 'POST',
    path: '/internal/v1/integrations/{id}/rotate',
    permission: 'order.integrations.write',
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

export class PepsaOrderAdapter implements PlatformAdapter {
  readonly key = 'pepsa-order';
  readonly displayName = 'Pepsa Order';
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
        ROUTES.find((route) => route.key === 'fleet-health')!,
        {
          operation: 'fleet-health',
          method: 'GET',
          actor: {
            actorId: 'system',
            platformId,
            permissions: ['order.fleet.read'],
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
      throw new AppError(404, 'OPERATION_UNKNOWN', `Unknown order operation ${request.operation}`);
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
      throw new AppError(503, 'PLATFORM_CIRCUIT_OPEN', 'Pepsa Order is temporarily unavailable');

    const params = collectParams(operation.query, operation.payload);
    const path = `${resolvePath(route.path, params)}${buildQueryString(route, operation.query, params)}`;
    const reason =
      typeof operation.payload?.reason === 'string' ? operation.payload.reason.trim() : undefined;
    if (route.mutation && (!reason || reason.length < 3))
      throw new AppError(
        422,
        'OPERATION_CONTEXT_REQUIRED',
        'Order mutations require a change reason',
      );
    if (route.mutation && !operation.idempotencyKey)
      throw new AppError(
        422,
        'OPERATION_CONTEXT_REQUIRED',
        'Order mutations require an idempotency key',
      );

    const body = buildBody(route, operation.payload, params);
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
      throw new AppError(503, 'PLATFORM_UNAVAILABLE', 'Pepsa Order is unavailable', {
        cause: lastError instanceof Error ? lastError.name : 'network',
      });
    }

    this.failures = 0;
    this.openUntil = 0;
    if (route.key === 'metrics-read') {
      if (!response.ok)
        throw new AppError(response.status, 'PLATFORM_ERROR', 'Pepsa Order metrics request failed');
      return (await response.text()) as T;
    }

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
        'Pepsa Order rejected a control-plane request',
      );
      throw new AppError(
        response.status >= 500 ? 502 : response.status,
        parsed.error?.code ??
          (response.status === 429 ? 'PLATFORM_RATE_LIMITED' : 'PLATFORM_ERROR'),
        parsed.error?.message ??
          (response.status === 429
            ? 'Pepsa Order is temporarily rate limited. Try again shortly.'
            : 'Platform request failed'),
        response.status === 429 ? { retryAfter } : undefined,
      );
    }
    return (parsed.data ?? parsed) as T;
  }
}

export const pepsaOrderRouteCatalogue = ROUTES;
