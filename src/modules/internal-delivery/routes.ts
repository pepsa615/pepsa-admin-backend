import express from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import { sendIdentityEmail } from './mail.js';

const recoveryBodySchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  purpose: z.enum(['admin-invitation', 'password-recovery']),
  expiresInMinutes: z.number().int().positive(),
});

function requireBearerToken(expectedToken: string | undefined) {
  return (request: Request, response: Response, next: () => void) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!expectedToken || !token || token !== expectedToken) {
      response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid delivery token' } });
      return;
    }
    next();
  };
}

export function internalDeliveryRoutes(config: AppConfig) {
  const router = express.Router();

  router.post(
    '/admin-recovery',
    requireBearerToken(config.recoveryDelivery?.token),
    async (request, response) => {
      const body = recoveryBodySchema.parse(request.body);
      const actionUrl = `${config.frontendOrigin}/reset-password?token=${encodeURIComponent(body.token)}`;

      await sendIdentityEmail(config, {
        to: body.email,
        purpose: body.purpose,
        actionUrl,
        expiresInMinutes: body.expiresInMinutes,
        requestId: String(request.headers['x-request-id'] ?? ''),
      });

      response.status(202).json({ data: { accepted: true } });
    },
  );

  router.post(
    '/security-events',
    requireBearerToken(config.securityMonitoring?.token),
    (request, response) => {
      const payload = request.body as Record<string, unknown>;
      logger.info(
        {
          event: 'SECURITY_MONITORING_EVENT',
          auditEventId: payload.id,
          action: payload.action,
          outcome: payload.outcome,
          sequence: payload.sequence,
        },
        'Audit event forwarded to local security sink',
      );
      response.status(204).end();
    },
  );

  return router;
}
