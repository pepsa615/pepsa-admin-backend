import { Prisma, type AdminStatus, type MembershipStatus } from '@prisma/client';
import type { AppConfig } from '../../core/config.js';
import { hashPassword, randomToken, sha256 } from '../../core/crypto.js';
import type { Database } from '../../core/database.js';
import { AppError, assertFound } from '../../core/errors.js';
import { deliverIdentityToken } from '../../core/identity-delivery.js';
import type { AuditService } from '../audit/service.js';
import { ApprovalService } from '../approvals/service.js';

export class AccessService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly config?: AppConfig,
  ) {}

  async listAdministrators() {
    return this.db.adminUser.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        mfaStatus: true,
        lastLoginAt: true,
        createdAt: true,
        memberships: { include: { platform: { select: { id: true, key: true, name: true } } } },
        assignments: {
          where: { revokedAt: null },
          include: {
            role: { select: { id: true, key: true, name: true } },
            platform: { select: { id: true, key: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async invite(input: {
    email: string;
    name: string;
    actorId: string;
    requestId: string;
    reason: string;
  }) {
    const existing = await this.db.adminUser.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (existing)
      throw new AppError(409, 'ADMIN_EXISTS', 'An administrator with this email already exists');
    const invitationToken = randomToken(32);
    const user = await this.db.adminUser.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: await hashPassword(randomToken(48)),
        status: 'INVITED',
        passwordResets: {
          create: {
            tokenHash: sha256(`${invitationToken}:${this.config?.session.secret ?? ''}`),
            expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
          },
        },
      },
    });
    try {
      await this.deliverInvitation(user.email, invitationToken, input.requestId);
    } catch (error) {
      // Do not leave an unusable INVITED account that prevents the operator
      // from retrying with the same email address.
      await this.db.adminUser.delete({ where: { id: user.id } });
      throw error;
    }
    await this.audit.record({
      actorId: input.actorId,
      action: 'admin.invited',
      targetType: 'AdminUser',
      targetId: user.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      ...(this.config?.environment === 'production' ? {} : { developmentToken: invitationToken }),
    };
  }

  async resendInvitation(input: {
    userId: string;
    actorId: string;
    requestId: string;
    reason: string;
  }) {
    const user = assertFound(
      await this.db.adminUser.findUnique({ where: { id: input.userId } }),
      'Administrator not found',
    );
    if (user.mfaStatus === 'ENABLED' || user.lastLoginAt)
      throw new AppError(
        409,
        'ADMIN_ALREADY_ONBOARDED',
        'Invitations can only be resent before MFA setup and the first sign-in',
      );

    const invitationToken = randomToken(32);
    const reset = await this.db.$transaction(async (transaction) => {
      await transaction.passwordResetToken.updateMany({
        where: { adminUserId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return transaction.passwordResetToken.create({
        data: {
          adminUserId: user.id,
          tokenHash: sha256(`${invitationToken}:${this.config?.session.secret ?? ''}`),
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        },
      });
    });
    try {
      await this.deliverInvitation(user.email, invitationToken, input.requestId);
    } catch (error) {
      await this.db.passwordResetToken.update({
        where: { id: reset.id },
        data: { consumedAt: new Date() },
      });
      throw error;
    }
    await this.audit.record({
      actorId: input.actorId,
      action: 'admin.invitation.resent',
      targetType: 'AdminUser',
      targetId: user.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
    });
    return {
      accepted: true,
      ...(this.config?.environment === 'production' ? {} : { developmentToken: invitationToken }),
    };
  }

  private deliverInvitation(email: string, token: string, requestId: string) {
    return deliverIdentityToken(this.config?.recoveryDelivery, {
      email,
      token,
      purpose: 'admin-invitation',
      expiresInMinutes: 24 * 60,
      requestId,
      failureCode: 'INVITATION_DELIVERY_FAILED',
      failureMessage: 'Invitation delivery failed',
    });
  }

  async updateStatus(input: {
    userId: string;
    status: AdminStatus;
    actorId: string;
    requestId: string;
    reason: string;
  }) {
    if (input.userId === input.actorId && input.status !== 'ACTIVE')
      throw new AppError(409, 'SELF_LOCKOUT', 'You cannot suspend or deactivate your own account');
    const user = assertFound(
      await this.db.adminUser.findUnique({ where: { id: input.userId } }),
      'Administrator not found',
    );
    await this.db.$transaction([
      this.db.adminUser.update({ where: { id: user.id }, data: { status: input.status } }),
      ...(input.status !== 'ACTIVE'
        ? [
            this.db.adminSession.updateMany({
              where: { adminUserId: user.id, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);
    await this.audit.record({
      actorId: input.actorId,
      action: `admin.status.${input.status.toLowerCase()}`,
      targetType: 'AdminUser',
      targetId: user.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
      metadata: { previousStatus: user.status },
    });
  }

  async setMembership(input: {
    userId: string;
    platformId: string;
    status: MembershipStatus;
    expiresAt?: Date;
    actorId: string;
    requestId: string;
    reason: string;
  }) {
    await Promise.all([
      assertFound(
        await this.db.adminUser.findUnique({ where: { id: input.userId } }),
        'Administrator not found',
      ),
      assertFound(
        await this.db.platform.findUnique({ where: { id: input.platformId } }),
        'Platform not found',
      ),
    ]);
    const membership = await this.db.platformMembership.upsert({
      where: {
        adminUserId_platformId: { adminUserId: input.userId, platformId: input.platformId },
      },
      create: {
        adminUserId: input.userId,
        platformId: input.platformId,
        status: input.status,
        expiresAt: input.expiresAt,
      },
      update: { status: input.status, expiresAt: input.expiresAt },
    });
    if (input.status !== 'ACTIVE')
      await this.db.adminSession.updateMany({
        where: { adminUserId: input.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    await this.audit.record({
      actorId: input.actorId,
      platformId: input.platformId,
      action: `membership.${input.status.toLowerCase()}`,
      targetType: 'PlatformMembership',
      targetId: membership.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
      metadata: { expiresAt: input.expiresAt?.toISOString() },
    });
    return membership;
  }

  async assignRole(input: {
    userId: string;
    roleId: string;
    platformId?: string;
    environmentId?: string;
    resourceScope?: Record<string, unknown>;
    expiresAt?: Date;
    actorId: string;
    actorPermissions: Set<string>;
    requestId: string;
    reason: string;
    approvalId?: string;
  }) {
    const role = assertFound(
      await this.db.role.findUnique({
        where: { id: input.roleId },
        include: { permissions: { include: { permission: true } } },
      }),
      'Role not found',
    );
    if (
      !input.actorPermissions.has('admin.super') &&
      role.permissions.some(({ permission }) => !permission.delegatable)
    ) {
      await this.audit.record({
        actorId: input.actorId,
        platformId: input.platformId,
        action: 'role.assignment.denied',
        targetType: 'Role',
        targetId: role.id,
        outcome: 'DENIED',
        reason: input.reason,
        requestId: input.requestId,
      });
      throw new AppError(
        403,
        'ROLE_NOT_DELEGATABLE',
        'This role contains permissions you cannot delegate',
      );
    }
    if (role.platformId !== (input.platformId ?? null))
      throw new AppError(
        422,
        'ROLE_SCOPE_MISMATCH',
        'Role does not belong to the selected platform',
      );
    if (input.environmentId) {
      if (!input.platformId)
        throw new AppError(
          422,
          'ENVIRONMENT_SCOPE_INVALID',
          'Global roles cannot target an environment',
        );
      const environment = await this.db.platformEnvironment.findUnique({
        where: { id: input.environmentId },
      });
      if (!environment || environment.platformId !== input.platformId)
        throw new AppError(
          422,
          'ENVIRONMENT_SCOPE_INVALID',
          'Environment does not belong to the platform',
        );
    }
    if (input.platformId) {
      const membership = await this.db.platformMembership.findUnique({
        where: {
          adminUserId_platformId: { adminUserId: input.userId, platformId: input.platformId },
        },
      });
      if (!membership || membership.status !== 'ACTIVE')
        throw new AppError(409, 'MEMBERSHIP_REQUIRED', 'An active platform membership is required');
    }
    const expiredAssignments = await this.db.roleAssignment.findMany({
      where: {
        adminUserId: input.userId,
        roleId: input.roleId,
        revokedAt: null,
        expiresAt: { lte: new Date() },
      },
      select: { id: true, platformId: true },
    });
    if (expiredAssignments.length) {
      await this.db.roleAssignment.updateMany({
        where: { id: { in: expiredAssignments.map(({ id }) => id) }, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'Assignment expired' },
      });
      for (const expired of expiredAssignments)
        await this.audit.record({
          platformId: expired.platformId ?? undefined,
          action: 'role.expired',
          targetType: 'RoleAssignment',
          targetId: expired.id,
          outcome: 'SUCCESS',
          reason: 'Configured assignment expiry reached',
          requestId: input.requestId,
        });
    }
    const existing = await this.db.roleAssignment.findFirst({
      where: {
        adminUserId: input.userId,
        roleId: input.roleId,
        platformId: input.platformId ?? null,
        environmentId: input.environmentId ?? null,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (existing) throw new AppError(409, 'ROLE_ALREADY_ASSIGNED', 'This role is already active');
    if (role.permissions.some(({ permission }) => permission.riskLevel === 'CRITICAL'))
      await ApprovalService.assertApproved(this.db, {
        id: input.approvalId,
        requesterId: input.actorId,
        action: 'role.assign',
        platformId: input.platformId,
        payload: {
          userId: input.userId,
          roleId: input.roleId,
          platformId: input.platformId ?? null,
          environmentId: input.environmentId ?? null,
          resourceScope: input.resourceScope ?? null,
          expiresAt: input.expiresAt?.toISOString() ?? null,
        },
      });
    const assignment = await this.db.roleAssignment.create({
      data: {
        adminUserId: input.userId,
        roleId: input.roleId,
        platformId: input.platformId,
        environmentId: input.environmentId,
        resourceScope: input.resourceScope as Prisma.InputJsonValue | undefined,
        grantedBy: input.actorId,
        expiresAt: input.expiresAt,
      },
    });
    await this.db.adminSession.updateMany({
      where: { adminUserId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId: input.actorId,
      platformId: input.platformId,
      action: 'role.assigned',
      targetType: 'RoleAssignment',
      targetId: assignment.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
      metadata: {
        roleId: input.roleId,
        userId: input.userId,
        expiresAt: input.expiresAt?.toISOString(),
        environmentId: input.environmentId,
        resourceScope: input.resourceScope,
      },
    });
    return assignment;
  }

  async revokeAssignment(input: {
    assignmentId: string;
    actorId: string;
    requestId: string;
    reason: string;
  }) {
    const assignment = assertFound(
      await this.db.roleAssignment.findUnique({ where: { id: input.assignmentId } }),
      'Assignment not found',
    );
    if (assignment.revokedAt)
      throw new AppError(409, 'ALREADY_REVOKED', 'Assignment is already revoked');
    const updated = await this.db.roleAssignment.update({
      where: { id: assignment.id },
      data: { revokedAt: new Date(), revokeReason: input.reason },
    });
    await this.db.adminSession.updateMany({
      where: { adminUserId: assignment.adminUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId: input.actorId,
      platformId: assignment.platformId ?? undefined,
      action: 'role.revoked',
      targetType: 'RoleAssignment',
      targetId: assignment.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
    });
    return updated;
  }

  roles(platformId?: string) {
    return this.db.role.findMany({
      where: { platformId: platformId ?? null, status: 'ACTIVE' },
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
  }

  permissions(platformId?: string) {
    return this.db.permission.findMany({
      where: { platformId: platformId ?? null },
      orderBy: { key: 'asc' },
    });
  }

  async createRole(input: {
    platformId?: string;
    key: string;
    name: string;
    description?: string;
    permissionIds: string[];
    approvalId?: string;
    actorId: string;
    reason: string;
    requestId: string;
  }) {
    const platform = input.platformId
      ? assertFound(
          await this.db.platform.findUnique({ where: { id: input.platformId } }),
          'Platform not found',
        )
      : undefined;
    const permissions = await this.db.permission.findMany({
      where: { id: { in: input.permissionIds } },
    });
    if (permissions.length !== new Set(input.permissionIds).size)
      throw new AppError(422, 'INVALID_PERMISSION', 'One or more permissions do not exist');
    if (permissions.some((permission) => (permission.platformId ?? undefined) !== input.platformId))
      throw new AppError(422, 'ROLE_SCOPE_MISMATCH', 'All permissions must match the role scope');
    if (permissions.some(({ riskLevel }) => riskLevel === 'CRITICAL'))
      await ApprovalService.assertApproved(this.db, {
        id: input.approvalId,
        requesterId: input.actorId,
        action: 'role.define',
        platformId: input.platformId,
        payload: {
          platformId: input.platformId ?? null,
          key: input.key,
          name: input.name,
          permissionIds: [...input.permissionIds].sort(),
        },
      });
    const role = await this.db.role.create({
      data: {
        platformId: input.platformId,
        scope: platform?.key ?? 'global',
        key: input.key,
        name: input.name,
        description: input.description,
        permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) },
      },
      include: { permissions: { include: { permission: true } } },
    });
    await this.audit.record({
      actorId: input.actorId,
      platformId: input.platformId,
      action: 'role.created',
      targetType: 'Role',
      targetId: role.id,
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: input.requestId,
      metadata: { permissionKeys: permissions.map(({ key }) => key) },
    });
    return role;
  }
}
