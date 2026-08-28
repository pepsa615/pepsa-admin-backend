export interface PlatformHealth {
  status: 'available' | 'degraded' | 'unavailable';
  checkedAt: string;
}

export interface ActorContext {
  actorId: string;
  platformId: string;
  permissions: string[];
  requestId: string;
  environmentId?: string;
  environment?: string;
  resourceScopes?: Array<Record<string, unknown>>;
}

export interface PlatformCapabilities {
  version: string;
  operations: Array<{
    key: string;
    method: 'GET' | 'POST';
    permission: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    async?: boolean;
  }>;
}

export interface PlatformOperationRequest {
  operation: string;
  method: 'GET' | 'POST';
  actor: ActorContext;
  idempotencyKey?: string;
  payload?: Record<string, unknown>;
  query?: URLSearchParams;
}

export interface PlatformAdapter {
  readonly key: string;
  readonly displayName: string;
  checkHealth(platformId: string): Promise<PlatformHealth>;
  capabilities(platformId: string): Promise<PlatformCapabilities>;
  execute<T = unknown>(request: PlatformOperationRequest): Promise<T>;
}
