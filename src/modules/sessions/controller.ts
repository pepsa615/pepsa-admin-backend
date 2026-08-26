import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../../core/config.js';
import type { SessionService } from './service.js';

const revokeSchema = z.object({ reason: z.string().trim().min(8).max(500) });
export class SessionController {
  constructor(
    private readonly service: SessionService,
    private readonly config: AppConfig,
  ) {}
  list = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.list(
        request.admin!.id,
        request.admin!.permissions.has('admin.sessions.read') ||
          request.admin!.permissions.has('admin.super'),
        typeof request.query.userId === 'string' ? request.query.userId : undefined,
      ),
    });
  revoke = async (request: Request, response: Response) => {
    const current = await this.service.revoke({
      sessionId: String(request.params.id),
      actorId: request.admin!.id,
      currentSessionId: request.admin!.sessionId,
      canManage:
        request.admin!.permissions.has('admin.sessions.manage') ||
        request.admin!.permissions.has('admin.super'),
      reason: revokeSchema.parse(request.body).reason,
      requestId: response.locals.requestId,
    });
    if (current)
      response.clearCookie(this.config.session.cookieName, {
        httpOnly: true,
        secure: this.config.session.secure,
        sameSite: this.config.session.sameSite,
        partitioned: this.config.session.partitioned,
        path: '/admin-api/v1',
      });
    response.status(204).end();
  };
}
