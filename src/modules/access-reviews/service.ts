import { Prisma } from '@prisma/client';
import type { Database } from '../../core/database.js';
import { AppError, assertFound } from '../../core/errors.js';
import type { AuditService } from '../audit/service.js';
import type { NotificationService } from '../notifications/service.js';

const include = {
  reviewer: { select: { id: true, name: true, email: true } },
  platform: { select: { id: true, key: true, name: true } },
  items: {
    include: {
      user: { select: { id: true, name: true, email: true, status: true } },
      assignment: { include: { role: { select: { id: true, key: true, name: true } } } },
    },
    orderBy: { id: 'asc' as const },
  },
};

export class AccessReviewService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  list(actorId: string, canReadAll: boolean) {
    return this.db.accessReview.findMany({
      where: canReadAll ? {} : { reviewerId: actorId },
      include,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async create(input: {
    reviewerId: string;
    platformId: string;
    name: string;
    dueAt: Date;
    requestId: string;
  }) {
    if (input.dueAt <= new Date())
      throw new AppError(422, 'INVALID_REVIEW_DUE_DATE', 'Review due date must be in the future');
    const assignments = await this.db.roleAssignment.findMany({
      where: {
        platformId: input.platformId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true, adminUserId: true },
    });
    const review = await this.db.accessReview.create({
      data: {
        reviewerId: input.reviewerId,
        platformId: input.platformId,
        name: input.name,
        dueAt: input.dueAt,
        status: 'ACTIVE',
        startedAt: new Date(),
        items: {
          create: assignments.map((assignment) => ({
            assignmentId: assignment.id,
            adminUserId: assignment.adminUserId,
          })),
        },
      },
      include,
    });
    await Promise.all([
      this.audit.record({
        actorId: input.reviewerId,
        platformId: input.platformId,
        action: 'access_review.started',
        targetType: 'AccessReview',
        targetId: review.id,
        outcome: 'SUCCESS',
        requestId: input.requestId,
        metadata: { assignments: assignments.length, dueAt: input.dueAt.toISOString() },
      }),
      this.notifications.create({
        adminUserId: input.reviewerId,
        type: 'access_review.assigned',
        title: 'Access review assigned',
        message: `${input.name} contains ${assignments.length} assignments to certify.`,
        href: `/access-reviews/${review.id}`,
      }),
    ]);
    return review;
  }

  async decide(input: {
    reviewId: string;
    itemId: string;
    actorId: string;
    canManageAll: boolean;
    decision: 'KEEP' | 'REVOKE';
    reason: string;
    requestId: string;
  }) {
    const review = assertFound(
      await this.db.accessReview.findUnique({ where: { id: input.reviewId } }),
      'Access review not found',
    );
    if (review.reviewerId !== input.actorId && !input.canManageAll)
      throw new AppError(403, 'FORBIDDEN', 'You are not the assigned reviewer');
    if (review.status !== 'ACTIVE')
      throw new AppError(409, 'REVIEW_NOT_ACTIVE', 'Access review is not active');
    const item = assertFound(
      await this.db.accessReviewItem.findFirst({
        where: { id: input.itemId, reviewId: review.id },
      }),
      'Review item not found',
    );
    if (item.decision) throw new AppError(409, 'ITEM_DECIDED', 'Review item is already decided');
    await this.db.$transaction(
      async (tx) => {
        await tx.accessReviewItem.update({
          where: { id: item.id },
          data: { decision: input.decision, reason: input.reason, decidedAt: new Date() },
        });
        if (input.decision === 'REVOKE') {
          await tx.roleAssignment.update({
            where: { id: item.assignmentId },
            data: { revokedAt: new Date(), revokeReason: input.reason },
          });
          await tx.adminSession.updateMany({
            where: { adminUserId: item.adminUserId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        const remaining = await tx.accessReviewItem.count({
          where: { reviewId: review.id, decision: null },
        });
        if (remaining === 0)
          await tx.accessReview.update({
            where: { id: review.id },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await Promise.all([
      this.audit.record({
        actorId: input.actorId,
        platformId: review.platformId,
        action: `access_review.${input.decision.toLowerCase()}`,
        targetType: 'RoleAssignment',
        targetId: item.assignmentId,
        outcome: 'SUCCESS',
        reason: input.reason,
        requestId: input.requestId,
      }),
      input.decision === 'REVOKE'
        ? this.notifications.create({
            adminUserId: item.adminUserId,
            type: 'access.revoked',
            title: 'Platform access revoked',
            message: 'An access review revoked one of your platform role assignments.',
            href: '/profile',
          })
        : Promise.resolve(),
    ]);
    return this.db.accessReview.findUnique({ where: { id: review.id }, include });
  }
}
