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
const basPermissions: Array<[string, RiskLevel]> = [
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
const orderPermissions: Array<[string, RiskLevel, boolean]> = [
  ['order.catalog.read', 'LOW', true],
  ['order.partners.read', 'LOW', true],
  ['order.partners.write', 'HIGH', true],
  ['order.credentials.issue', 'CRITICAL', false],
  ['order.credentials.revoke', 'CRITICAL', false],
  ['order.fleet.read', 'LOW', true],
  ['order.fleet.sync', 'MEDIUM', true],
  ['order.processing.read', 'LOW', true],
  ['order.processing.run', 'HIGH', true],
  ['order.processing.manual', 'HIGH', false],
  ['order.dispatch.read', 'LOW', true],
  ['order.dispatch.write', 'HIGH', true],
  ['order.dispatch.refund', 'CRITICAL', false],
  ['order.operations.policies.read', 'LOW', true],
  ['order.operations.policies.write', 'CRITICAL', false],
  ['order.events.read', 'MEDIUM', true],
  ['order.events.operate', 'HIGH', true],
  ['order.integrations.read', 'LOW', true],
  ['order.integrations.write', 'HIGH', false],
];
const paymentPermissions: Array<[string, RiskLevel, boolean]> = [
  ['payment.platforms.read', 'LOW', true],
  ['payment.platforms.write', 'HIGH', false],
  ['payment.platforms.keys.rotate', 'CRITICAL', false],
  ['payment.platforms.status', 'CRITICAL', false],
  ['payment.settings.transfer', 'HIGH', true],
  ['payment.settings.vas', 'HIGH', true],
  ['payment.settings.settlement', 'HIGH', true],
  ['payment.sva.provisioning.read', 'MEDIUM', true],
  ['payment.sva.provisioning.reconcile', 'CRITICAL', false],
  ['payment.checkout.provisioning.read', 'MEDIUM', true],
  ['payment.checkout.provisioning.reconcile', 'CRITICAL', false],
  ['payment.kyc.encryption.rotate', 'CRITICAL', false],
];

async function upsertPlatformWithEnvironments(input: {
  key: string;
  name: string;
  description: string;
  adapterType: string;
  /** Fail-closed: order/payment production stays DISABLED until evidence review. */
  productionStatus?: 'ACTIVE' | 'DISABLED';
}) {
  const productionStatus = input.productionStatus ?? 'ACTIVE';
  const platform = await db.platform.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      name: input.name,
      description: input.description,
      adapterType: input.adapterType,
      environments: {
        create: [{ key: 'production', name: 'Production', status: productionStatus }],
      },
    },
    update: { name: input.name, adapterType: input.adapterType, description: input.description },
  });
  // Deploy-lane isolation: one ACTIVE PlatformEnvironment per platform (key always `production`).
  const obsoleteEnvs = await db.platformEnvironment.findMany({
    where: { platformId: platform.id, key: { not: 'production' } },
    select: { id: true },
  });
  if (obsoleteEnvs.length) {
    await db.roleAssignment.updateMany({
      where: { environmentId: { in: obsoleteEnvs.map(({ id }) => id) } },
      data: { environmentId: null },
    });
    await db.platformEnvironment.updateMany({
      where: { id: { in: obsoleteEnvs.map(({ id }) => id) } },
      data: { status: 'DISABLED' },
    });
  }
  await db.platformEnvironment.upsert({
    where: { platformId_key: { platformId: platform.id, key: 'production' } },
    create: {
      platformId: platform.id,
      key: 'production',
      name: 'Production',
      status: productionStatus,
    },
    update: { name: 'Production', status: productionStatus },
  });
  return platform;
}

async function seedPlatformAccess(input: {
  platformId: string;
  platformKey: string;
  permissions: Array<[string, RiskLevel, boolean]>;
  operationsExclusions?: string[];
}) {
  const platformPerms = await Promise.all(
    input.permissions.map(([key, riskLevel, delegatable]) =>
      db.permission.upsert({
        where: { scope_key: { scope: input.platformKey, key } },
        create: {
          scope: input.platformKey,
          platformId: input.platformId,
          key,
          riskLevel,
          delegatable,
        },
        update: { riskLevel, delegatable },
      }),
    ),
  );
  const operationsRole = await db.role.upsert({
    where: { scope_key: { scope: input.platformKey, key: 'operations-admin' } },
    create: {
      scope: input.platformKey,
      platformId: input.platformId,
      key: 'operations-admin',
      name: 'Operations Admin',
      isSystemRole: true,
    },
    update: {},
  });
  const readonlyRole = await db.role.upsert({
    where: { scope_key: { scope: input.platformKey, key: 'read-only-auditor' } },
    create: {
      scope: input.platformKey,
      platformId: input.platformId,
      key: 'read-only-auditor',
      name: 'Read-only Auditor',
      isSystemRole: true,
    },
    update: {},
  });
  const exclusions = new Set(input.operationsExclusions ?? []);
  await Promise.all([
    ...[...exclusions].map(async (key) => {
      const permission = platformPerms.find((entry) => entry.key === key);
      if (!permission) return;
      await db.rolePermission.deleteMany({
        where: { roleId: operationsRole.id, permissionId: permission.id },
      });
    }),
    ...platformPerms
      .filter(({ key }) => !exclusions.has(key))
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
  return { operationsRole, readonlyRole, platformPerms };
}

async function main() {
  const basPlatform = await upsertPlatformWithEnvironments({
    key: 'business-as-a-service',
    name: 'Business as a Service',
    description: 'Pepsa business operations platform',
    adapterType: 'business-as-a-service',
  });
  // Staging admin lane: ACTIVE so Order/Payment UI and capabilities work against staging hosts.
  // Production admin lane: DISABLED until docs/admin/PRODUCTION_ENABLEMENT.md sign-off
  // (override with SEED_ORDER_PAYMENT_ENV_ACTIVE=1|0).
  const orderPaymentEnvActive =
    process.env.SEED_ORDER_PAYMENT_ENV_ACTIVE === '1'
      ? true
      : process.env.SEED_ORDER_PAYMENT_ENV_ACTIVE === '0'
        ? false
        : process.env.PEPSA_PM2_ENV === 'staging' || process.env.NODE_ENV !== 'production';
  const orderPaymentEnvStatus = orderPaymentEnvActive ? 'ACTIVE' : 'DISABLED';
  const orderPlatform = await upsertPlatformWithEnvironments({
    key: 'pepsa-order',
    name: 'Pepsa Order',
    description: 'Pepsa order and dispatch platform',
    adapterType: 'pepsa-order',
    productionStatus: orderPaymentEnvStatus,
  });
  const paymentPlatform = await upsertPlatformWithEnvironments({
    key: 'pepsa-payment',
    name: 'Pepsa Payment',
    description: 'Pepsa payment platform',
    adapterType: 'pepsa-payment',
    productionStatus: orderPaymentEnvStatus,
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

  const basAccess = await seedPlatformAccess({
    platformId: basPlatform.id,
    platformKey: basPlatform.key,
    permissions: basPermissions.map(([key, riskLevel]) => [
      key,
      riskLevel,
      key !== 'bas.assets.legal-hold',
    ]),
    operationsExclusions: ['bas.assets.legal-hold'],
  });
  const orderAccess = await seedPlatformAccess({
    platformId: orderPlatform.id,
    platformKey: orderPlatform.key,
    permissions: orderPermissions,
  });
  const paymentAccess = await seedPlatformAccess({
    platformId: paymentPlatform.id,
    platformKey: paymentPlatform.key,
    permissions: paymentPermissions,
  });

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

  await Promise.all([
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
  ]);

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const email2 = process.env.BOOTSTRAP_ADMIN2_EMAIL?.toLowerCase();
  const password2 = process.env.BOOTSTRAP_ADMIN2_PASSWORD;

  async function upsertBootstrapAdmin(input: { email: string; password: string; name: string }) {
    const admin = await db.adminUser.upsert({
      where: { email: input.email },
      create: {
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
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
    for (const access of [
      { platform: basPlatform, roleId: basAccess.operationsRole.id, label: 'bas' },
      { platform: orderPlatform, roleId: orderAccess.operationsRole.id, label: 'order' },
      { platform: paymentPlatform, roleId: paymentAccess.operationsRole.id, label: 'payment' },
    ]) {
      await db.platformMembership.upsert({
        where: {
          adminUserId_platformId: { adminUserId: admin.id, platformId: access.platform.id },
        },
        create: { adminUserId: admin.id, platformId: access.platform.id },
        update: { status: 'ACTIVE' },
      });
      await db.roleAssignment.upsert({
        where: { id: `bootstrap-${access.label}-${admin.id}` },
        create: {
          id: `bootstrap-${access.label}-${admin.id}`,
          adminUserId: admin.id,
          roleId: access.roleId,
          platformId: access.platform.id,
          grantedBy: admin.id,
        },
        update: { roleId: access.roleId, platformId: access.platform.id, revokedAt: null },
      });
    }
    return admin;
  }

  if (email && password) {
    if (password.length < 14)
      throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 14 characters');
    await upsertBootstrapAdmin({
      email,
      password,
      name: 'Bootstrap Administrator',
    });
  }

  if (email2 && password2) {
    if (password2.length < 14)
      throw new Error('BOOTSTRAP_ADMIN2_PASSWORD must contain at least 14 characters');
    await upsertBootstrapAdmin({
      email: email2,
      password: password2,
      name: process.env.BOOTSTRAP_ADMIN2_NAME?.trim() || 'Bootstrap Administrator',
    });
  }
}

main().finally(() => db.$disconnect());
