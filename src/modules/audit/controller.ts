import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuditService } from './service.js';

const querySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  platformId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().trim().max(100).optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  requestId: z.string().uuid().optional(),
});

export class AuditController {
  constructor(private readonly service: AuditService) {}
  list = async (request: Request, response: Response) => {
    response.json(await this.service.list(querySchema.parse(request.query)));
  };
  export = async (request: Request, response: Response) => {
    const query = querySchema.omit({ cursor: true, limit: true }).parse(request.query);
    response.json({
      data: {
        filename: `pepsa-audit-${new Date().toISOString().slice(0, 10)}.csv`,
        content: await this.service.export(query),
      },
    });
  };
  verify = async (_request: Request, response: Response) =>
    response.json({ data: await this.service.verifyChain() });
}
