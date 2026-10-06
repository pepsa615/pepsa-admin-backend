#!/usr/bin/env node
/**
 * Fix missing Order/Payment admin UI access on an existing database.
 *
 * - Ensures pepsa-order / pepsa-payment platforms + production env exist
 * - Optionally sets production env ACTIVE (default on PEPSA_PM2_ENV=staging)
 * - Grants ACTIVE membership + operations-admin role to BOOTSTRAP_ADMIN_EMAIL
 *   (or GRANT_ADMIN_EMAIL)
 *
 * Usage (from admin/backend with DATABASE_URL loaded):
 *   node scripts/grant-order-payment-access.mjs
 *   SEED_ORDER_PAYMENT_ENV_ACTIVE=1 GRANT_ADMIN_EMAIL=you@pepsa.co node scripts/grant-order-payment-access.mjs
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const email = (process.env.GRANT_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || '')
  .trim()
  .toLowerCase();
const activate =
  process.env.SEED_ORDER_PAYMENT_ENV_ACTIVE === '1'
    ? true
    : process.env.SEED_ORDER_PAYMENT_ENV_ACTIVE === '0'
      ? false
      : process.env.PEPSA_PM2_ENV === 'staging' || process.env.NODE_ENV !== 'production';

if (!email) {
  console.error('Set GRANT_ADMIN_EMAIL or BOOTSTRAP_ADMIN_EMAIL');
  process.exit(1);
}

async function ensurePlatform(key, name, adapterType) {
  const platform = await db.platform.upsert({
    where: { key },
    create: { key, name, adapterType, status: 'ACTIVE', description: name },
    update: { name, adapterType, status: 'ACTIVE' },
  });
  await db.platformEnvironment.upsert({
    where: { platformId_key: { platformId: platform.id, key: 'production' } },
    create: {
      platformId: platform.id,
      key: 'production',
      name: 'Production',
      status: activate ? 'ACTIVE' : 'DISABLED',
    },
    update: { status: activate ? 'ACTIVE' : 'DISABLED' },
  });
  const role = await db.role.findUnique({
    where: { scope_key: { scope: key, key: 'operations-admin' } },
  });
  return { platform, role };
}

const admin = await db.adminUser.findUnique({ where: { email } });
if (!admin) {
  console.error(`Admin user not found: ${email}`);
  process.exit(1);
}

const order = await ensurePlatform('pepsa-order', 'Pepsa Order', 'pepsa-order');
const payment = await ensurePlatform('pepsa-payment', 'Pepsa Payment', 'pepsa-payment');

for (const { platform, role, label } of [
  { ...order, label: 'order' },
  { ...payment, label: 'payment' },
]) {
  await db.platformMembership.upsert({
    where: { adminUserId_platformId: { adminUserId: admin.id, platformId: platform.id } },
    create: { adminUserId: admin.id, platformId: platform.id, status: 'ACTIVE' },
    update: { status: 'ACTIVE' },
  });
  if (!role) {
    console.warn(
      `Missing ${platform.key} operations-admin role — run prisma db seed to create permissions/roles, then re-run this script.`,
    );
    continue;
  }
  await db.roleAssignment.upsert({
    where: { id: `bootstrap-${label}-${admin.id}` },
    create: {
      id: `bootstrap-${label}-${admin.id}`,
      adminUserId: admin.id,
      roleId: role.id,
      platformId: platform.id,
      grantedBy: admin.id,
    },
    update: { roleId: role.id, platformId: platform.id, revokedAt: null },
  });
  console.log(
    JSON.stringify({
      platform: platform.key,
      membership: 'ACTIVE',
      role: role.key,
      envActive: activate,
    }),
  );
}

console.log(
  activate
    ? 'Done. Sign out/in (or refresh session) and select Pepsa Order / Pepsa Payment in the platform switcher.'
    : 'Done. Env left DISABLED — enable from Platforms page (Enable production env) or set SEED_ORDER_PAYMENT_ENV_ACTIVE=1.',
);
await db.$disconnect();
