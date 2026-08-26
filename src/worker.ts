import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './core/config.js';
import { prisma } from './core/database.js';
import { logger } from './core/logger.js';
import { createAdapterRegistry } from './integrations/create-registry.js';
import { AuditService } from './modules/audit/service.js';
import { AuditDeliveryService } from './modules/audit/delivery.js';
import { NotificationService } from './modules/notifications/service.js';
import { OperationService } from './modules/operations/service.js';
import { AccessExpiryService } from './modules/access/expiry.js';

const config = loadConfig();
const workerId = randomUUID();
const service = new OperationService(
  prisma,
  createAdapterRegistry(config),
  new AuditService(prisma),
  new NotificationService(prisma),
);
const auditDelivery = new AuditDeliveryService(prisma, config.securityMonitoring);
const accessExpiry = new AccessExpiryService(
  prisma,
  new AuditService(prisma),
  new NotificationService(prisma),
);
let stopping = false;

async function work() {
  while (!stopping) {
    try {
      const [operationWorked, auditWorked, expiryWorked] = await Promise.all([
        service.processNext(workerId),
        auditDelivery.processNext(),
        accessExpiry.processNext(),
      ]);
      if (!operationWorked && !auditWorked && !expiryWorked)
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    } catch (error) {
      logger.error({ error, workerId }, 'Operation worker iteration failed');
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  await prisma.$disconnect();
}

for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    logger.info({ signal, workerId }, 'Operation worker stopping');
    stopping = true;
  });

logger.info({ workerId }, 'Operation worker started');
void work();
