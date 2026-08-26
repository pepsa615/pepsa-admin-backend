import { randomUUID } from 'node:crypto';
import type { Database } from '../../core/database.js';
import type { AuditService } from '../audit/service.js';
import type { NotificationService } from '../notifications/service.js';

export class AccessExpiryService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async processNext() {
    const now = new Date();
    const assignment = await this.db.roleAssignment.findFirst({
      where: { revokedAt: null, expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' },
    });
    if (assignment) {
      const claimed = await this.db.roleAssignment.updateMany({
        where: { id: assignment.id, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'Assignment expired' },
      });
      if (claimed.count) {
        await this.db.adminSession.updateMany({
          where: { adminUserId: assignment.adminUserId, revokedAt: null },
          data: { revokedAt: now },
        });
        await Promise.all([
          this.audit.record({
            platformId: assignment.platformId ?? undefined,
            action: 'role.expired',
            targetType: 'RoleAssignment',
            targetId: assignment.id,
            outcome: 'SUCCESS',
            reason: 'Configured assignment expiry reached',
            requestId: randomUUID(),
          }),
          this.notifications.create({
            adminUserId: assignment.adminUserId,
            type: 'access.expired',
            title: 'Role assignment expired',
            message: 'A time-bound role assignment expired and active sessions were revoked.',
            href: '/profile',
          }),
        ]);
      }
      return true;
    }
    const membership = await this.db.platformMembership.findFirst({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' },
    });
    if (membership) {
      const claimed = await this.db.platformMembership.updateMany({
        where: { id: membership.id, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      if (claimed.count) {
        await this.db.adminSession.updateMany({
          where: { adminUserId: membership.adminUserId, revokedAt: null },
          data: { revokedAt: now },
        });
        await Promise.all([
          this.audit.record({
            platformId: membership.platformId,
            action: 'membership.expired',
            targetType: 'PlatformMembership',
            targetId: membership.id,
            outcome: 'SUCCESS',
            reason: 'Configured membership expiry reached',
            requestId: randomUUID(),
          }),
          this.notifications.create({
            adminUserId: membership.adminUserId,
            type: 'access.expired',
            title: 'Platform membership expired',
            message: 'A time-bound platform membership expired and active sessions were revoked.',
            href: '/profile',
          }),
        ]);
      }
      return true;
    }
    const emergency = await this.db.emergencyAccessGrant.findFirst({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' },
    });
    if (emergency) {
      const claimed = await this.db.emergencyAccessGrant.updateMany({
        where: { id: emergency.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });
      if (claimed.count) {
        await this.db.adminSession.updateMany({
          where: { adminUserId: emergency.adminUserId, revokedAt: null },
          data: { revokedAt: now },
        });
        await Promise.all([
          this.audit.record({
            platformId: emergency.platformId,
            action: 'emergency_access.expired',
            targetType: 'EmergencyAccessGrant',
            targetId: emergency.id,
            outcome: 'SUCCESS',
            reason: 'Emergency access expiry reached',
            requestId: randomUUID(),
            metadata: { incidentId: emergency.incidentId },
          }),
          this.notifications.create({
            adminUserId: emergency.adminUserId,
            type: 'emergency_access.expired',
            title: 'Emergency access expired',
            message: 'Time-bound emergency access ended and active sessions were revoked.',
            href: '/emergency-access',
          }),
        ]);
      }
      return true;
    }
    return false;
  }
}
