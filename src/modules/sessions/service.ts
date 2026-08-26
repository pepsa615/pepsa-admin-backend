import type { Database } from '../../core/database.js';
import { AppError, assertFound } from '../../core/errors.js';
import type { AuditService } from '../audit/service.js';

export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  list(actorId: string, canReadAll: boolean, userId?: string) {
    const adminUserId = canReadAll && userId ? userId : actorId;
    return this.db.adminSession.findMany({
      where: { adminUserId },
      select: {
        id: true,
        adminUserId: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        mfaVerifiedAt: true,
        stepUpAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(input: {
    sessionId: string;
    actorId: string;
    currentSessionId: string;
    canManage: boolean;
    reason: string;
    requestId: string;
  }) {
    const session = assertFound(
      await this.db.adminSession.findUnique({ where: { id: input.sessionId } }),
      'Session not found',
    );
    if (session.adminUserId !== input.actorId && !input.canManage)
      throw new AppError(403, 'FORBIDDEN', 'You cannot revoke this session');
    if (session.revokedAt) throw new AppError(409, 'SESSION_REVOKED', 'Session is already revoked');
    await this.db.adminSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId: input.actorId,
      action: 'session.revoked',
      targetType: 'AdminSession',
      targetId: session.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
      metadata: {
        affectedUserId: session.adminUserId,
        current: session.id === input.currentSessionId,
      },
    });
    return session.id === input.currentSessionId;
  }
}
