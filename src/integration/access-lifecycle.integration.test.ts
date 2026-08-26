import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { hashPassword, sha256 } from '../core/crypto.js';
import { loadConfig } from '../core/config.js';
import { AccessService } from '../modules/access/service.js';
import { AuditService } from '../modules/audit/service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const database = databaseUrl
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  : undefined;

afterAll(async () => database?.$disconnect());

describe.skipIf(!database)('access lifecycle persistence', () => {
  it('persists scoped grants, revokes sessions immediately, and protects audit rows', async () => {
    const db = database!;
    const suffix = randomUUID();
    const passwordHash = await hashPassword(`Integration-${suffix}`);
    const [actor, target, platform] = await Promise.all([
      db.adminUser.create({
        data: {
          email: `actor-${suffix}@example.com`,
          name: 'Integration Actor',
          passwordHash,
          status: 'ACTIVE',
          mfaStatus: 'ENABLED',
        },
      }),
      db.adminUser.create({
        data: {
          email: `target-${suffix}@example.com`,
          name: 'Integration Target',
          passwordHash,
          status: 'ACTIVE',
          mfaStatus: 'ENABLED',
        },
      }),
      db.platform.findUniqueOrThrow({ where: { key: 'business-as-a-service' } }),
    ]);
    const role = await db.role.findUniqueOrThrow({
      where: { scope_key: { scope: platform.key, key: 'read-only-auditor' } },
    });
    const environment = await db.platformEnvironment.findUniqueOrThrow({
      where: { platformId_key: { platformId: platform.id, key: 'staging' } },
    });
    const audit = new AuditService(db);
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: 'integration-session-secret-value',
      ACTOR_SIGNING_SECRET: 'integration-actor-signing-secret',
      MFA_ENCRYPTION_KEY: '11'.repeat(32),
    });
    const access = new AccessService(db, audit, config);
    const requestId = randomUUID();

    const invited = await access.invite({
      email: `invited-${suffix}@example.com`,
      name: 'Invited Administrator',
      actorId: actor.id,
      reason: 'Integration invitation identity verification',
      requestId,
    });
    expect(invited.developmentToken).toBeTruthy();
    expect(
      await db.passwordResetToken.count({ where: { adminUserId: invited.id, consumedAt: null } }),
    ).toBe(1);

    await access.setMembership({
      userId: target.id,
      platformId: platform.id,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86_400_000),
      actorId: actor.id,
      reason: 'Integration access lifecycle verification',
      requestId,
    });
    await db.adminSession.create({
      data: {
        adminUserId: target.id,
        tokenHash: sha256(randomUUID()),
        csrfHash: sha256(randomUUID()),
        expiresAt: new Date(Date.now() + 3_600_000),
        mfaVerifiedAt: new Date(),
      },
    });
    const assignment = await access.assignRole({
      userId: target.id,
      roleId: role.id,
      platformId: platform.id,
      environmentId: environment.id,
      resourceScope: { businessIds: [randomUUID()] },
      expiresAt: new Date(Date.now() + 3_600_000),
      actorId: actor.id,
      actorPermissions: new Set(['admin.super']),
      reason: 'Integration scoped role verification',
      requestId,
    });

    expect(
      await db.adminSession.count({ where: { adminUserId: target.id, revokedAt: { not: null } } }),
    ).toBe(1);
    expect(assignment.environmentId).toBe(environment.id);
    expect(assignment.resourceScope).toMatchObject({ businessIds: expect.any(Array) });

    await db.adminSession.create({
      data: {
        adminUserId: target.id,
        tokenHash: sha256(randomUUID()),
        csrfHash: sha256(randomUUID()),
        expiresAt: new Date(Date.now() + 3_600_000),
        mfaVerifiedAt: new Date(),
      },
    });
    await access.revokeAssignment({
      assignmentId: assignment.id,
      actorId: actor.id,
      reason: 'Integration immediate revocation verification',
      requestId,
    });
    expect(
      await db.adminSession.count({ where: { adminUserId: target.id, revokedAt: { not: null } } }),
    ).toBe(2);
    expect(await db.auditEvent.count({ where: { requestId } })).toBeGreaterThanOrEqual(3);
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "AuditEvent" SET "action" = 'tampered' WHERE "requestId" = $1`,
        requestId,
      ),
    ).rejects.toThrow();
  }, 30_000);
});
