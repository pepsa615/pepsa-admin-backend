import 'dotenv/config';
import { PrismaClient, type RiskLevel } from '@prisma/client';
import { hashPassword } from '../src/core/crypto.js';

const db = new PrismaClient();
const globalPermissions: Array<[string, RiskLevel, boolean]> = [
  ['admin.super', 'CRITICAL', false],
  ['admin.users.read', 'LOW', true],
  ['admin.users.manage', 'HIGH', true],
  ['admin.access.manage', 'CRITICAL', true],
  ['admin.roles.read', 'LOW', true],
  ['admin.platforms.read', 'LOW', true],
  ['admin.audit.read', 'MEDIUM', true],
  ['admin.operations.read', 'MEDIUM', true],
  ['admin.platforms.manage', 'HIGH', false],
  ['admin.roles.manage', 'CRITICAL', false],
  ['admin.sessions.read', 'MEDIUM', true],
  ['admin.sessions.manage', 'HIGH', false],
  ['admin.approvals.read', 'MEDIUM', true],
  ['admin.approvals.request', 'HIGH', true],
  ['admin.approvals.manage', 'CRITICAL', false],
  ['admin.reviews.read', 'MEDIUM', true],
  ['admin.reviews.manage', 'HIGH', false],
  ['admin.emergency.request', 'CRITICAL', false],
  ['admin.emergency.approve', 'CRITICAL', false],
];
const platformPermissions: Array<[string, RiskLevel]> = [
  ['bas.dashboard.read', 'LOW'],
  ['bas.businesses.read', 'MEDIUM'],
  ['bas.businesses.review', 'HIGH'],
  ['bas.assets.legal-hold', 'HIGH'],
  ['bas.orders.read', 'LOW'],
  ['bas.orders.manage', 'HIGH'],
  ['bas.finance.read', 'HIGH'],
  ['bas.pricing.read', 'MEDIUM'],
  ['bas.pricing.manage', 'HIGH'],
  ['bas.transactions.read', 'HIGH'],
  ['bas.invoices.read', 'HIGH'],
  ['bas.api-keys.read', 'HIGH'],
  ['bas.api-keys.revoke', 'HIGH'],
  ['bas.wallets.adjust', 'CRITICAL'],
  ['bas.webhooks.read', 'MEDIUM'],
  ['bas.webhooks.manage', 'HIGH'],
  ['bas.webhooks.replay', 'HIGH'],
  ['bas.audit.read', 'MEDIUM'],
];

async function main() {
  const platform = await db.platform.upsert({
    where: { key: 'business-as-a-service' },
    create: {
      key: 'business-as-a-service',
      name: 'Business as a Service',
      description: 'Pepsa business operations platform',
      adapterType: 'business-as-a-service',
      environments: {
        create: [
          { key: 'production', name: 'Production' },
          { key: 'sandbox', name: 'Sandbox' },
        ],
      },
    },
    update: { name: 'Business as a Service', adapterType: 'business-as-a-service' },
  });
  await db.platformEnvironment.upsert({
    where: { platformId_key: { platformId: platform.id, key: 'sandbox' } },
    create: { platformId: platform.id, key: 'sandbox', name: 'Sandbox' },
    update: { name: 'Sandbox', status: 'ACTIVE' },
  });
  await db.platformEnvironment.updateMany({
    where: { platformId: platform.id, key: 'staging' },
    data: { status: 'DISABLED' },
  });
  await db.platformEnvironment.upsert({
    where: { platformId_key: { platformId: platform.id, key: 'production' } },
    create: { platformId: platform.id, key: 'production', name: 'Production' },
    update: { name: 'Production', status: 'ACTIVE' },
  });
  const globals = await Promise.all(
    globalPermissions.map(([key, riskLevel, delegatable]) =>
      db.permission.upsert({
        where: { scope_key: { scope: 'global', key } },
        create: { scope: 'global', key, riskLevel, delegatable },
        update: { riskLevel, delegatable },
      }),
    ),
  );
  const platformPerms = await Promise.all(
    platformPermissions.map(([key, riskLevel]) =>
      db.permission.upsert({
        where: { scope_key: { scope: platform.key, key } },
        create: {
          scope: platform.key,
          platformId: platform.id,
          key,
          riskLevel,
          delegatable: key !== 'bas.assets.legal-hold',
        },
        update: { riskLevel, delegatable: key !== 'bas.assets.legal-hold' },
      }),
    ),
  );
  const superRole = await db.role.upsert({
    where: { scope_key: { scope: 'global', key: 'super-admin' } },
    create: {
      scope: 'global',
      key: 'super-admin',
      name: 'Super Admin',
      description: 'Full control-plane authority',
      isSystemRole: true,
    },
    update: {},
  });
  const accessRole = await db.role.upsert({
    where: { scope_key: { scope: 'global', key: 'access-manager' } },
    create: { scope: 'global', key: 'access-manager', name: 'Access Manager', isSystemRole: true },
    update: {},
  });
  const auditorRole = await db.role.upsert({
    where: { scope_key: { scope: 'global', key: 'security-auditor' } },
    create: {
      scope: 'global',
      key: 'security-auditor',
      name: 'Security Auditor',
      isSystemRole: true,
    },
    update: {},
  });
  const operationsRole = await db.role.upsert({
    where: { scope_key: { scope: platform.key, key: 'operations-admin' } },
    create: {
      scope: platform.key,
      platformId: platform.id,
      key: 'operations-admin',
      name: 'Operations Admin',
      isSystemRole: true,
    },
    update: {},
  });
  const readonlyRole = await db.role.upsert({
    where: { scope_key: { scope: platform.key, key: 'read-only-auditor' } },
    create: {
      scope: platform.key,
      platformId: platform.id,
      key: 'read-only-auditor',
      name: 'Read-only Auditor',
      isSystemRole: true,
    },
    update: {},
  });
  const legalHoldPermission = platformPerms.find(({ key }) => key === 'bas.assets.legal-hold');
  if (!legalHoldPermission) throw new Error('Asset legal-hold permission was not created');
  await Promise.all([
    db.rolePermission.deleteMany({
      where: { roleId: operationsRole.id, permissionId: legalHoldPermission.id },
    }),
    ...globals.map((permission) =>
      db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: superRole.id, permissionId: permission.id } },
        create: { roleId: superRole.id, permissionId: permission.id },
        update: {},
      }),
    ),
    ...globals
      .filter(({ key }) =>
        [
          'admin.users.read',
          'admin.users.manage',
          'admin.access.manage',
          'admin.roles.read',
          'admin.platforms.read',
          'admin.approvals.read',
          'admin.approvals.request',
          'admin.reviews.read',
        ].includes(key),
      )
      .map((permission) =>
        db.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: accessRole.id, permissionId: permission.id } },
          create: { roleId: accessRole.id, permissionId: permission.id },
          update: {},
        }),
      ),
    ...globals
      .filter(({ key }) =>
        [
          'admin.users.read',
          'admin.roles.read',
          'admin.platforms.read',
          'admin.audit.read',
          'admin.operations.read',
          'admin.approvals.read',
          'admin.reviews.read',
          'admin.sessions.read',
        ].includes(key),
      )
      .map((permission) =>
        db.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: auditorRole.id, permissionId: permission.id } },
          create: { roleId: auditorRole.id, permissionId: permission.id },
          update: {},
        }),
      ),
    ...platformPerms
      .filter(({ key }) => key !== 'bas.assets.legal-hold')
      .map((permission) =>
        db.rolePermission.upsert({
          where: {
            roleId_permissionId: { roleId: operationsRole.id, permissionId: permission.id },
          },
          create: { roleId: operationsRole.id, permissionId: permission.id },
          update: {},
        }),
      ),
    ...platformPerms
      .filter(({ key }) => key.endsWith('.read'))
      .map((permission) =>
        db.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: readonlyRole.id, permissionId: permission.id } },
          create: { roleId: readonlyRole.id, permissionId: permission.id },
          update: {},
        }),
      ),
  ]);
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 14)
      throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 14 characters');
    const admin = await db.adminUser.upsert({
      where: { email },
      create: {
        email,
        name: 'Bootstrap Administrator',
        passwordHash: await hashPassword(password),
        status: 'ACTIVE',
      },
      update: {},
    });
    const admin2 = await db.adminUser.upsert({
      where: { email: "folorunsopraise580@gmail.com" },
      create: {
        email,
        name: 'Praise Folorunso',
        passwordHash: await hashPassword("Praise1212."),
        status: 'ACTIVE',
      },
      update: {},
    });
    await db.roleAssignment.upsert({
      where: { id: `bootstrap-${admin.id}` },
      create: {
        id: `bootstrap-${admin.id}`,
        adminUserId: admin.id,
        roleId: superRole.id,
        grantedBy: admin.id,
      },
      update: {},
    });
    await db.roleAssignment.upsert({
      where: { id: `bootstrap-${admin2.id}` },
      create: {
        id: `bootstrap-${admin2.id}`,
        adminUserId: admin2.id,
        roleId: superRole.id,
        grantedBy: admin2.id,
      },
      update: {},
    });
    await db.platformMembership.upsert({
      where: { adminUserId_platformId: { adminUserId: admin.id, platformId: platform.id } },
      create: { adminUserId: admin.id, platformId: platform.id },
      update: { status: 'ACTIVE' },
    });
    await db.platformMembership.upsert({
      where: { adminUserId_platformId: { adminUserId: admin2.id, platformId: platform.id } },
      create: { adminUserId: admin2.id, platformId: platform.id },
      update: { status: 'ACTIVE' },
    });
    await db.roleAssignment.upsert({
      where: { id: `bootstrap-bas-${admin.id}` },
      create: {
        id: `bootstrap-bas-${admin.id}`,
        adminUserId: admin.id,
        roleId: operationsRole.id,
        platformId: platform.id,
        grantedBy: admin.id,
      },
      update: {},
    });
    await db.roleAssignment.upsert({
      where: { id: `bootstrap-bas-${admin2.id}` },
      create: {
        id: `bootstrap-bas-${admin2.id}`,
        adminUserId: admin2.id,
        roleId: operationsRole.id,
        platformId: platform.id,
        grantedBy: admin2.id,
      },
      update: {},
    });
  }
}

main().finally(() => db.$disconnect());
