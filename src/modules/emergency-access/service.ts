import type { Database } from '../../core/database.js';
import { AppError, assertFound } from '../../core/errors.js';
import type { AuditService } from '../audit/service.js';
import type { NotificationService } from '../notifications/service.js';

const include = {
  user: { select: { id: true, name: true, email: true } },
  requester: { select: { id: true, name: true, email: true } },
  approver: { select: { id: true, name: true, email: true } },
  platform: { select: { id: true, key: true, name: true } },
};

export class EmergencyAccessService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async list(actorId: string, canReadAll: boolean) {
    return this.db.emergencyAccessGrant.findMany({
      where: canReadAll
        ? {}
        : { OR: [{ adminUserId: actorId }, { requesterId: actorId }, { approverId: actorId }] },
      include,
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
  }

  async request(input: {
    adminUserId: string;
    requesterId: string;
    platformId: string;
    permissions: string[];
    reason: string;
    incidentId: string;
    expiresAt: Date;
    requestId: string;
  }) {
    const duration = input.expiresAt.getTime() - Date.now();
    if (duration <= 0 || duration > 60 * 60_000)
      throw new AppError(
        422,
        'INVALID_EMERGENCY_DURATION',
        'Emergency access must expire within one hour',
      );
    const valid = await this.db.permission.findMany({
      where: { platformId: input.platformId, key: { in: input.permissions } },
      select: { key: true },
    });
    if (valid.length !== new Set(input.permissions).size)
      throw new AppError(
        422,
        'INVALID_PERMISSION',
        'One or more permissions are not valid for this platform',
      );
    const grant = await this.db.emergencyAccessGrant.create({ data: input, include });
    await this.audit.record({
      actorId: input.requesterId,
      platformId: input.platformId,
      action: 'emergency_access.requested',
      targetType: 'EmergencyAccessGrant',
      targetId: grant.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
      metadata: { incidentId: input.incidentId, expiresAt: input.expiresAt.toISOString() },
    });
    return grant;
  }

  async decide(input: {
    id: string;
    approverId: string;
    approve: boolean;
    reason: string;
    requestId: string;
  }) {
    const grant = assertFound(
      await this.db.emergencyAccessGrant.findUnique({ where: { id: input.id } }),
      'Emergency access request not found',
    );
    if (grant.status !== 'PENDING')
      throw new AppError(409, 'EMERGENCY_ACCESS_RESOLVED', 'Emergency access is already resolved');
    if (grant.requesterId === input.approverId)
      throw new AppError(
        403,
        'SELF_APPROVAL_FORBIDDEN',
        'Requester cannot approve emergency access',
      );
    if (grant.expiresAt <= new Date())
      throw new AppError(409, 'EMERGENCY_ACCESS_EXPIRED', 'Emergency access request has expired');
    const updated = await this.db.emergencyAccessGrant.update({
      where: { id: grant.id },
      data: {
        status: input.approve ? 'ACTIVE' : 'REJECTED',
        approverId: input.approverId,
        approvedAt: input.approve ? new Date() : null,
      },
      include,
    });
    await Promise.all([
      this.audit.record({
        actorId: input.approverId,
        platformId: grant.platformId,
        action: input.approve ? 'emergency_access.approved' : 'emergency_access.rejected',
        targetType: 'EmergencyAccessGrant',
        targetId: grant.id,
        outcome: 'SUCCESS',
        reason: input.reason,
        requestId: input.requestId,
        metadata: { incidentId: grant.incidentId },
      }),
      this.notifications.create({
        adminUserId: grant.adminUserId,
        type: 'emergency_access.updated',
        title: input.approve ? 'Emergency access active' : 'Emergency access rejected',
        message: input.approve
          ? `Emergency access is active until ${grant.expiresAt.toISOString()}.`
          : 'The emergency access request was rejected.',
        href: '/emergency-access',
      }),
    ]);
    return updated;
  }

  async revoke(id: string, actorId: string, reason: string, requestId: string) {
    const grant = assertFound(
      await this.db.emergencyAccessGrant.findUnique({ where: { id } }),
      'Emergency access grant not found',
    );
    if (grant.status !== 'ACTIVE')
      throw new AppError(409, 'EMERGENCY_ACCESS_NOT_ACTIVE', 'Emergency access is not active');
    await this.db.$transaction([
      this.db.emergencyAccessGrant.update({
        where: { id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      }),
      this.db.adminSession.updateMany({
        where: { adminUserId: grant.adminUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorId,
      platformId: grant.platformId,
      action: 'emergency_access.revoked',
      targetType: 'EmergencyAccessGrant',
      targetId: id,
      outcome: 'SUCCESS',
      reason,
      requestId,
      metadata: { incidentId: grant.incidentId },
    });
  }
}
