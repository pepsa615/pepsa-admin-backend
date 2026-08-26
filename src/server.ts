import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { prisma } from './core/database.js';

const config = loadConfig();
const server = createServer(createApp(config));

server.listen(config.port, () => {
  logger.info(
    {
      event: 'ADMIN_API_STARTED',
      port: config.port,
      platforms: ['business-as-a-service'],
    },
    'Pepsa Admin API listening',
  );
});

async function shutdown(signal: string) {
  logger.info({ event: 'ADMIN_API_STOPPING', signal }, 'Pepsa Admin API stopping');
  server.close(async (error) => {
    if (error) {
      logger.error({ error }, 'Pepsa Admin API shutdown failed');
      process.exitCode = 1;
      return;
    }

    await prisma.$disconnect();
    process.exitCode = 0;
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
