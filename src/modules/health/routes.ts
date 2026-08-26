import { Router } from 'express';
import type { Database } from '../../core/database.js';
import { asyncHandler } from '../../core/http.js';
import type { PlatformAdapterRegistry } from '../../integrations/registry.js';

export function healthRoutes(db?: Database, adapters?: PlatformAdapterRegistry) {
  const router = Router();

  router.get('/live', (_request, response) => {
    response.json({ status: 'ok', service: 'pepsa-admin-backend' });
  });

  router.get(
    '/ready',
    asyncHandler(async (_request, response) => {
      if (db) await db.$queryRaw`SELECT 1`;
      const platforms = adapters
        ? await Promise.all(
            adapters.list().map(async (adapter) => ({
              key: adapter.key,
              ...(await adapter.checkHealth(adapter.key)),
            })),
          )
        : [];
      const ready = platforms.every(({ status }) => status !== 'unavailable');
      response
        .status(ready ? 200 : 503)
        .json({ status: ready ? 'ready' : 'degraded', service: 'pepsa-admin-backend', platforms });
    }),
  );

  return router;
}
