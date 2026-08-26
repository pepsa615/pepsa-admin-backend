import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../core/database.js';
import { ApprovalService } from './service.js';

describe('approval authorization', () => {
  it('binds an approval to its exact payload and claims it once', async () => {
    const approval = {
      id: 'approval-id',
      status: 'APPROVED',
      expiresAt: new Date(Date.now() + 60_000),
      requesterId: 'actor-id',
      action: 'role.assign',
      platformId: 'platform-id',
      executedAt: null,
      payload: { roleId: 'role-a', userId: 'user-a' },
    };
    const db = {
      approvalRequest: {
        findUnique: vi.fn().mockResolvedValue(approval),
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      },
    } as unknown as Database;
    await expect(
      ApprovalService.assertApproved(db, {
        id: approval.id,
        requesterId: approval.requesterId,
        action: approval.action,
        platformId: approval.platformId,
        payload: { userId: 'user-a', roleId: 'role-a' },
      }),
    ).resolves.toMatchObject({ id: approval.id });
    await expect(
      ApprovalService.assertApproved(db, {
        id: approval.id,
        requesterId: approval.requesterId,
        action: approval.action,
        platformId: approval.platformId,
        payload: { roleId: 'role-a', userId: 'user-a' },
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_USED' });
    await expect(
      ApprovalService.assertApproved(db, {
        id: approval.id,
        requesterId: approval.requesterId,
        action: approval.action,
        platformId: approval.platformId,
        payload: { roleId: 'role-b', userId: 'user-a' },
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
  });
});
