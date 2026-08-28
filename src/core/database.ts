import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  pepsaAdminPrisma?: PrismaClient;
};

/** Keep Aiven / small Postgres plans from exhausting connection slots. */
export function withPrismaPoolLimits(databaseUrl: string, connectionLimit = 5) {
  const url = new URL(databaseUrl);
  if (!url.searchParams.has('connection_limit'))
    url.searchParams.set('connection_limit', String(connectionLimit));
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '10');
  return url.toString();
}

const connectionLimit = Number(process.env.PRISMA_CONNECTION_LIMIT ?? 5);
const datasourceUrl = withPrismaPoolLimits(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pepsa_admin',
  Number.isFinite(connectionLimit) ? connectionLimit : 5,
);

export const prisma =
  globalForPrisma.pepsaAdminPrisma ??
  new PrismaClient({
    datasources: { db: { url: datasourceUrl } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.pepsaAdminPrisma = prisma;

export type Database = PrismaClient;
