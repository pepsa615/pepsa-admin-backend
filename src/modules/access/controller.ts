import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AccessService } from './service.js';

const reason = z.string().trim().min(8).max(500);
const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(2).max(120),
  reason,
});
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']), reason });
const membershipSchema = z.object({
  platformId: z.string().uuid(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']),
  expiresAt: z.string().datetime().optional(),
  reason,
});
const assignmentSchema = z.object({
  roleId: z.string().uuid(),
  platformId: z.string().uuid().optional(),
  environmentId: z.string().uuid().optional(),
  resourceScope: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
  reason,
  approvalId: z.string().uuid().optional(),
});
const revokeSchema = z.object({ reason });
const roleSchema = z.object({
  platformId: z.string().uuid().optional(),
  key: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  permissionIds: z.array(z.string().uuid()).min(1).max(100),
  approvalId: z.string().uuid().optional(),
  reason,
});

export class AccessController {
  constructor(private readonly service: AccessService) {}
  list = async (_request: Request, response: Response) =>
    response.json({ data: await this.service.listAdministrators() });
  invite = async (request: Request, response: Response) =>
    response.status(201).json({
      data: await this.service.invite({
        ...inviteSchema.parse(request.body),
        actorId: request.admin!.id,
        requestId: response.locals.requestId,
      }),
    });
  status = async (request: Request, response: Response) => {
    await this.service.updateStatus({
      ...statusSchema.parse(request.body),
      userId: String(request.params.userId),
      actorId: request.admin!.id,
      requestId: response.locals.requestId,
    });
    response.status(204).end();
  };
  membership = async (request: Request, response: Response) => {
    const body = membershipSchema.parse(request.body);
    response.json({
      data: await this.service.setMembership({
        ...body,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        userId: String(request.params.userId),
        actorId: request.admin!.id,
        requestId: response.locals.requestId,
      }),
    });
  };
  assign = async (request: Request, response: Response) => {
    const body = assignmentSchema.parse(request.body);
    response.status(201).json({
      data: await this.service.assignRole({
        ...body,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        userId: String(request.params.userId),
        actorId: request.admin!.id,
        actorPermissions: request.admin!.permissions,
        requestId: response.locals.requestId,
      }),
    });
  };
  revoke = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.revokeAssignment({
        ...revokeSchema.parse(request.body),
        assignmentId: String(request.params.assignmentId),
        actorId: request.admin!.id,
        requestId: response.locals.requestId,
      }),
    });
  roles = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.roles(
        typeof request.query.platformId === 'string' ? request.query.platformId : undefined,
      ),
    });
  permissions = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.permissions(
        typeof request.query.platformId === 'string' ? request.query.platformId : undefined,
      ),
    });
  createRole = async (request: Request, response: Response) =>
    response.status(201).json({
      data: await this.service.createRole({
        ...roleSchema.parse(request.body),
        actorId: request.admin!.id,
        requestId: response.locals.requestId,
      }),
    });
}
