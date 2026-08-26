import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ApprovalService } from './service.js';

const reason = z.string().trim().min(8).max(500);
const requestSchema = z.object({
  platformId: z.string().uuid().optional(),
  action: z.enum([
    'role.assign',
    'role.define',
    'operation.execute',
    'emergency.access',
    'platform.credentials.rotate',
  ]),
  riskLevel: z.enum(['HIGH', 'CRITICAL']),
  reason,
  payload: z.record(z.unknown()),
  approvalsRequired: z.number().int().min(1).max(2).default(1),
  expiresAt: z.string().datetime(),
});
const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason });
const cancelSchema = z.object({ reason });
const listSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED']).optional(),
});

export class ApprovalController {
  constructor(private readonly service: ApprovalService) {}
  list = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.list({
        actorId: request.admin!.id,
        canReadAll:
          request.admin!.permissions.has('admin.approvals.manage') ||
          request.admin!.permissions.has('admin.super'),
        status: listSchema.parse(request.query).status,
      }),
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
        approvalId: String(request.params.id),
        approverId: request.admin!.id,
        requestId: response.locals.requestId,
      }),
    });
  cancel = async (request: Request, response: Response) => {
    await this.service.cancel(
      String(request.params.id),
      request.admin!.id,
      cancelSchema.parse(request.body).reason,
      response.locals.requestId,
    );
    response.status(204).end();
  };
}
