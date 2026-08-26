import type { Request, Response } from 'express';
import { z } from 'zod';
import type { EmergencyAccessService } from './service.js';

const reason = z.string().trim().min(8).max(500);
const requestSchema = z.object({
  adminUserId: z.string().uuid(),
  platformId: z.string().uuid(),
  permissions: z.array(z.string().min(3).max(120)).min(1).max(20),
  reason,
  incidentId: z.string().trim().min(3).max(120),
  expiresAt: z.string().datetime(),
});
const decisionSchema = z.object({ approve: z.boolean(), reason });
const revokeSchema = z.object({ reason });

export class EmergencyAccessController {
  constructor(private readonly service: EmergencyAccessService) {}
  list = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.list(
        request.admin!.id,
        request.admin!.permissions.has('admin.emergency.approve') ||
          request.admin!.permissions.has('admin.super'),
      ),
    });
  create = async (request: Request, response: Response) => {
    const body = requestSchema.parse(request.body);
    response.status(201).json({
      data: await this.service.request({
        ...body,
        expiresAt: new Date(body.expiresAt),
        requesterId: request.admin!.id,
        requestId: response.locals.requestId,
      }),
    });
  };
  decide = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.decide({
        ...decisionSchema.parse(request.body),
        id: String(request.params.id),
        approverId: request.admin!.id,
        requestId: response.locals.requestId,
      }),
    });
  revoke = async (request: Request, response: Response) => {
    await this.service.revoke(
      String(request.params.id),
      request.admin!.id,
      revokeSchema.parse(request.body).reason,
      response.locals.requestId,
    );
    response.status(204).end();
  };
}
