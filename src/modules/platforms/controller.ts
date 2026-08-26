import type { Request, Response } from 'express';
import type { PlatformService } from './service.js';
import { z } from 'zod';

const reason = z.string().trim().min(8).max(500);
const secretReference = z
  .string()
  .trim()
  .max(300)
  .regex(/^(vault|aws-sm|gcp-sm|azure-kv):\/\//, 'Use an approved secret-manager reference')
  .optional();
const createSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  adapterType: z.string().trim().min(2).max(120),
  reason,
});
const rotationSchema = z.object({
  configurationReference: secretReference.unwrap(),
  approvalId: z.string().uuid(),
  reason,
});
const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(['ACTIVE', 'DEGRADED', 'DISABLED']).optional(),
  reason,
});
const environmentSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(40),
  name: z.string().trim().min(2).max(80),
  endpointReference: secretReference,
  reason,
});

export class PlatformController {
  constructor(private readonly service: PlatformService) {}
  list = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.list(
        request.admin!.id,
        request.admin!.permissions.has('admin.platforms.manage') ||
          request.admin!.permissions.has('admin.super'),
      ),
    });
  health = async (request: Request, response: Response) =>
    response.json({ data: await this.service.health(String(request.params.platformKey)) });
  capabilities = async (request: Request, response: Response) =>
    response.json({ data: await this.service.capabilities(String(request.params.platformKey)) });
  create = async (request: Request, response: Response) =>
    response.status(201).json({
      data: await this.service.create({
        ...createSchema.parse(request.body),
        actorId: request.admin!.id,
        requestId: response.locals.requestId,
      }),
    });
  update = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.update({
        ...updateSchema.parse(request.body),
        id: String(request.params.id),
        actorId: request.admin!.id,
        requestId: response.locals.requestId,
      }),
    });
  addEnvironment = async (request: Request, response: Response) =>
    response.status(201).json({
      data: await this.service.addEnvironment({
        ...environmentSchema.parse(request.body),
        platformId: String(request.params.id),
        actorId: request.admin!.id,
        requestId: response.locals.requestId,
      }),
    });
  rotateCredentials = async (request: Request, response: Response) => {
    await this.service.rotateCredentials({
      ...rotationSchema.parse(request.body),
      id: String(request.params.id),
      actorId: request.admin!.id,
      requestId: response.locals.requestId,
    });
    response.status(204).end();
  };
}
