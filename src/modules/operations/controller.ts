import type { Request, Response } from 'express';
import { z } from 'zod';
import type { OperationService } from './service.js';

const mutationSchema = z.object({
  reason: z.string().trim().min(8).max(500),
  payload: z.record(z.unknown()).optional(),
  approvalId: z.string().uuid().optional(),
});
export class OperationController {
  constructor(private readonly service: OperationService) {}
  read = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.execute({
        platformKey: String(request.params.platformKey),
        operation: String(request.params.operation),
        method: 'GET',
        actorId: request.admin!.id,
        permissions: response.locals.effectivePermissions as Set<string>,
        requestId: response.locals.requestId,
        environmentId: response.locals.platformEnvironment.id as string,
        environment: response.locals.platformEnvironment.key as string,
        assignmentScopes: response.locals.assignmentScopes,
        query: new URLSearchParams(
          Object.entries(request.query).flatMap(([key, value]) =>
            typeof value === 'string' ? [[key, value]] : [],
          ),
        ),
      }),
    });
  mutate = async (request: Request, response: Response) => {
    const body = mutationSchema.parse(request.body);
    response.status(202).json({
      data: await this.service.execute({
        platformKey: String(request.params.platformKey),
        operation: String(request.params.operation),
        method: 'POST',
        actorId: request.admin!.id,
        permissions: response.locals.effectivePermissions as Set<string>,
        requestId: response.locals.requestId,
        idempotencyKey: request.header('idempotency-key') ?? undefined,
        environmentId: response.locals.platformEnvironment.id as string,
        environment: response.locals.platformEnvironment.key as string,
        assignmentScopes: response.locals.assignmentScopes,
        ...body,
      }),
    });
  };
  list = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.list(
        request.admin!.id,
        request.admin!.permissions.has('admin.operations.read') ||
          request.admin!.permissions.has('admin.super'),
      ),
    });
  get = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.get(
        String(request.params.id),
        request.admin!.id,
        request.admin!.permissions.has('admin.operations.read') ||
          request.admin!.permissions.has('admin.super'),
      ),
    });
}
