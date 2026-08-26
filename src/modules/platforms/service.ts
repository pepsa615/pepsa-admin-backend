import type { Database } from '../../core/database.js';
import { AppError, assertFound } from '../../core/errors.js';
import type { PlatformAdapterRegistry } from '../../integrations/registry.js';
import type { AuditService } from '../audit/service.js';
import { ApprovalService } from '../approvals/service.js';

export class PlatformService {
  constructor(
    private readonly db: Database,
    private readonly adapters: PlatformAdapterRegistry,
    private readonly audit: AuditService,
  ) {}

  async list(adminId: string, canViewAll: boolean) {
    const rows = await this.db.platform.findMany({
      where: canViewAll
        ? {}
        : {
            memberships: {
              some: {
                adminUserId: adminId,
                status: 'ACTIVE',
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
            },
          },
      include: { environments: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(({ configurationReference: _secretReference, ...platform }) => platform);
  }

  async health(platformKey: string) {
    const platform = assertFound(
      await this.db.platform.findUnique({ where: { key: platformKey } }),
      'Platform not found',
    );
    const adapter = this.adapters.get(platform.adapterType);
    if (!adapter)
      throw new AppError(503, 'ADAPTER_UNAVAILABLE', 'Platform adapter is not configured');
    return adapter.checkHealth(platform.id);
  }

  async capabilities(platformKey: string) {
    const platform = assertFound(
      await this.db.platform.findUnique({ where: { key: platformKey } }),
      'Platform not found',
    );
    const adapter = this.adapters.get(platform.adapterType);
    if (!adapter)
      throw new AppError(503, 'ADAPTER_UNAVAILABLE', 'Platform adapter is not configured');
    return adapter.capabilities(platform.id);
  }

  async create(input: {
    key: string;
    name: string;
    description?: string;
    adapterType: string;
    actorId: string;
    reason: string;
    requestId: string;
  }) {
    if (await this.db.platform.findUnique({ where: { key: input.key } }))
      throw new AppError(409, 'PLATFORM_EXISTS', 'Platform key already exists');
    const configured = Boolean(this.adapters.get(input.adapterType));
    const platform = await this.db.platform.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description,
        adapterType: input.adapterType,
        status: configured ? 'ACTIVE' : 'DISABLED',
      },
    });
    await this.audit.record({
      actorId: input.actorId,
      platformId: platform.id,
      action: 'platform.registered',
      targetType: 'Platform',
      targetId: platform.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
      metadata: { adapterType: input.adapterType, adapterConfigured: configured },
    });
    return platform;
  }

  async rotateCredentials(input: {
    id: string;
    configurationReference: string;
    approvalId?: string;
    actorId: string;
    reason: string;
    requestId: string;
  }) {
    const platform = assertFound(
      await this.db.platform.findUnique({ where: { id: input.id } }),
      'Platform not found',
    );
    await ApprovalService.assertApproved(this.db, {
      id: input.approvalId,
      requesterId: input.actorId,
      action: 'platform.credentials.rotate',
      platformId: platform.id,
      payload: { configurationReference: input.configurationReference },
    });
    await this.db.platform.update({
      where: { id: platform.id },
      data: { configurationReference: input.configurationReference },
    });
    await this.audit.record({
      actorId: input.actorId,
      platformId: platform.id,
      action: 'platform.credentials.rotated',
      targetType: 'Platform',
      targetId: platform.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
      metadata: {
        referenceChanged: platform.configurationReference !== input.configurationReference,
      },
    });
  }

  async update(input: {
    id: string;
    name?: string;
    description?: string;
    status?: 'ACTIVE' | 'DEGRADED' | 'DISABLED';
    actorId: string;
    reason: string;
    requestId: string;
  }) {
    const current = assertFound(
      await this.db.platform.findUnique({ where: { id: input.id } }),
      'Platform not found',
    );
    const platform = await this.db.platform.update({
      where: { id: input.id },
      data: {
        name: input.name,
        description: input.description,
        status: input.status,
      },
    });
    await this.audit.record({
      actorId: input.actorId,
      platformId: current.id,
      action: 'platform.updated',
      targetType: 'Platform',
      targetId: current.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
      metadata: { previousStatus: current.status, status: platform.status },
    });
    return platform;
  }

  async addEnvironment(input: {
    platformId: string;
    key: string;
    name: string;
    endpointReference?: string;
    actorId: string;
    reason: string;
    requestId: string;
  }) {
    const platform = assertFound(
      await this.db.platform.findUnique({ where: { id: input.platformId } }),
      'Platform not found',
    );
    const environment = await this.db.platformEnvironment.create({
      data: {
        platformId: platform.id,
        key: input.key,
        name: input.name,
        endpointReference: input.endpointReference,
      },
    });
    await this.audit.record({
      actorId: input.actorId,
      platformId: platform.id,
      action: 'platform.environment.created',
      targetType: 'PlatformEnvironment',
      targetId: environment.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
    });
    return environment;
  }
}
