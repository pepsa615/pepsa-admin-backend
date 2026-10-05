#!/usr/bin/env node
/**
 * One-off: collapse admin PlatformEnvironment rows to a single ACTIVE `production` key per platform.
 * Remaps RoleAssignment.environmentId that pointed at sandbox/staging to null.
 *
 * Usage: DATABASE_URL=... node scripts/collapse-platform-environments.mjs --dry-run
 *        DATABASE_URL=... node scripts/collapse-platform-environments.mjs --execute
 */
import { PrismaClient } from '@prisma/client';

const execute = process.argv.includes('--execute');
const prisma = new PrismaClient();

async function main() {
  const platforms = await prisma.platform.findMany({
    include: { environments: true },
  });
  const plan = [];
  for (const platform of platforms) {
    const obsolete = platform.environments.filter((env) => env.key !== 'production');
    const production = platform.environments.find((env) => env.key === 'production');
    plan.push({
      platformKey: platform.key,
      obsoleteKeys: obsolete.map((env) => env.key),
      hasProduction: Boolean(production),
    });
    if (!execute) continue;
    if (obsolete.length) {
      await prisma.roleAssignment.updateMany({
        where: { environmentId: { in: obsolete.map((env) => env.id) } },
        data: { environmentId: null },
      });
      await prisma.platformEnvironment.updateMany({
        where: { id: { in: obsolete.map((env) => env.id) } },
        data: { status: 'DISABLED' },
      });
    }
    if (production) {
      await prisma.platformEnvironment.update({
        where: { id: production.id },
        data: { status: production.status === 'DISABLED' ? production.status : 'ACTIVE' },
      });
    } else {
      await prisma.platformEnvironment.create({
        data: {
          platformId: platform.id,
          key: 'production',
          name: 'Production',
          status: 'ACTIVE',
        },
      });
    }
  }
  console.log(JSON.stringify({ dryRun: !execute, plan }, null, 2));
  if (!execute) console.error('Dry run only. Re-run with --execute to apply.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
