import { Prisma, type RiskLevel } from '@prisma/client';
import type { Database } from '../../core/database.js';
import { AppError, assertFound } from '../../core/errors.js';
import type { AuditService } from '../audit/service.js';
import type { NotificationService } from '../notifications/service.js';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

const approvalInclude = {
  requester: { select: { id: true, name: true, email: true } },
  platform: { select: { id: true, key: true, name: true } },
  decisions: {
    include: { approver: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
};

export class ApprovalService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  list(input: { actorId: string; canReadAll: boolean; status?: string }) {
    return this.db.approvalRequest.findMany({
      where: {
        ...(input.canReadAll ? {} : { requesterId: input.actorId }),
        ...(input.status ? { status: input.status as never } : {}),
      },
      include: approvalInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async request(input: {
    requesterId: string;
    platformId?: string;
    action: string;
    riskLevel: RiskLevel;
    reason: string;
    payload: Record<string, unknown>;
    approvalsRequired: number;
    expiresAt: Date;
    requestId: string;
  }) {
    if (input.expiresAt <= new Date() || input.expiresAt.getTime() > Date.now() + 24 * 60 * 60_000)
      throw new AppError(422, 'INVALID_APPROVAL_EXPIRY', 'Approval must expire within 24 hours');
    const approval = await this.db.approvalRequest.create({
      data: {
        requesterId: input.requesterId,
        platformId: input.platformId,
        action: input.action,
        riskLevel: input.riskLevel,
        reason: input.reason,
        payload: input.payload as Prisma.InputJsonValue,
        approvalsRequired: input.approvalsRequired,
        expiresAt: input.expiresAt,
      },
      include: approvalInclude,
    });
    await this.audit.record({
      actorId: input.requesterId,
      platformId: input.platformId,
      action: 'approval.requested',
      targetType: 'ApprovalRequest',
      targetId: approval.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
      metadata: { action: input.action, riskLevel: input.riskLevel },
    });
    return approval;
  }

  async decide(input: {
    approvalId: string;
    approverId: string;
    decision: 'APPROVE' | 'REJECT';
    reason: string;
    requestId: string;
  }) {
    const current = assertFound(
      await this.db.approvalRequest.findUnique({
        where: { id: input.approvalId },
        include: { decisions: true },
      }),
      'Approval request not found',
    );
    if (current.status !== 'PENDING')
      throw new AppError(409, 'APPROVAL_RESOLVED', 'Approval request is already resolved');
    if (current.expiresAt <= new Date()) {
      await this.db.approvalRequest.update({
        where: { id: current.id },
        data: { status: 'EXPIRED', resolvedAt: new Date() },
      });
      throw new AppError(409, 'APPROVAL_EXPIRED', 'Approval request has expired');
    }
    if (current.requesterId === input.approverId)
      throw new AppError(
        403,
        'SELF_APPROVAL_FORBIDDEN',
        'Requesters cannot approve their own action',
      );
    const result = await this.db.$transaction(
      async (tx) => {
        await tx.approvalDecision.create({
          data: {
            requestId: current.id,
            approverId: input.approverId,
            decision: input.decision,
            reason: input.reason,
          },
        });
        const approvedCount =
          current.decisions.filter(({ decision }) => decision === 'APPROVE').length +
          (input.decision === 'APPROVE' ? 1 : 0);
        const status =
          input.decision === 'REJECT'
            ? 'REJECTED'
            : approvedCount >= current.approvalsRequired
              ? 'APPROVED'
              : 'PENDING';
        return tx.approvalRequest.update({
          where: { id: current.id },
          data: { status, ...(status !== 'PENDING' ? { resolvedAt: new Date() } : {}) },
          include: approvalInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await Promise.all([
      this.audit.record({
        actorId: input.approverId,
        platformId: current.platformId ?? undefined,
        action: `approval.${input.decision.toLowerCase()}`,
        targetType: 'ApprovalRequest',
        targetId: current.id,
        outcome: 'SUCCESS',
        reason: input.reason,
        requestId: input.requestId,
      }),
      this.notifications.create({
        adminUserId: current.requesterId,
        type: 'approval.updated',
        title: `Approval ${result.status.toLowerCase()}`,
        message: `${current.action} was ${result.status.toLowerCase()}.`,
        href: '/approvals',
        metadata: { approvalId: current.id },
      }),
    ]);
    return result;
  }

  async cancel(id: string, actorId: string, reason: string, requestId: string) {
    const current = assertFound(
      await this.db.approvalRequest.findUnique({ where: { id } }),
      'Approval request not found',
    );
    if (current.requesterId !== actorId)
      throw new AppError(403, 'FORBIDDEN', 'Only the requester can cancel this approval');
    if (current.status !== 'PENDING')
      throw new AppError(409, 'APPROVAL_RESOLVED', 'Approval request is already resolved');
    await this.db.approvalRequest.update({
      where: { id },
      data: { status: 'CANCELLED', resolvedAt: new Date() },
    });
    await this.audit.record({
      actorId,
      platformId: current.platformId ?? undefined,
      action: 'approval.cancelled',
      targetType: 'ApprovalRequest',
      targetId: id,
      outcome: 'SUCCESS',
      reason,
      requestId,
    });
  }

  static async assertApproved(
    db: Database,
    input: {
      id?: string;
      requesterId: string;
      action: string;
      platformId?: string;
      payload: Record<string, unknown>;
    },
  ) {
    if (!input.id) throw new AppError(428, 'APPROVAL_REQUIRED', 'An approved request is required');
    const approval = assertFound(
      await db.approvalRequest.findUnique({ where: { id: input.id } }),
      'Approval request not found',
    );
    if (
      approval.status !== 'APPROVED' ||
      approval.expiresAt <= new Date() ||
      approval.requesterId !== input.requesterId ||
      approval.action !== input.action ||
      (approval.platformId ?? undefined) !== input.platformId ||
      canonicalJson(approval.payload) !== canonicalJson(input.payload)
    )
      throw new AppError(403, 'APPROVAL_INVALID', 'Approval does not authorize this action');
    const claimed = await db.approvalRequest.updateMany({
      where: { id: approval.id, status: 'APPROVED', executedAt: null },
      data: { executedAt: new Date() },
    });
    if (claimed.count !== 1)
      throw new AppError(409, 'APPROVAL_USED', 'Approval has already been used');
    return approval;
  }
}
