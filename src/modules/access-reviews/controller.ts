import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AccessReviewService } from './service.js';

const createSchema = z.object({
  platformId: z.string().uuid(),
  name: z.string().trim().min(3).max(120),
  dueAt: z.string().datetime(),
});
const decisionSchema = z.object({
  decision: z.enum(['KEEP', 'REVOKE']),
  reason: z.string().trim().min(8).max(500),
});

export class AccessReviewController {
  constructor(private readonly service: AccessReviewService) {}
  list = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.list(
        request.admin!.id,
        request.admin!.permissions.has('admin.reviews.manage') ||
          request.admin!.permissions.has('admin.super'),
      ),
    });
  create = async (request: Request, response: Response) => {
    const body = createSchema.parse(request.body);
    response.status(201).json({
      data: await this.service.create({
        ...body,
        dueAt: new Date(body.dueAt),
        reviewerId: request.admin!.id,
        requestId: response.locals.requestId,
      }),
    });
  };
  decide = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.decide({
        ...decisionSchema.parse(request.body),
        reviewId: String(request.params.reviewId),
        itemId: String(request.params.itemId),
        actorId: request.admin!.id,
        canManageAll:
          request.admin!.permissions.has('admin.reviews.manage') ||
          request.admin!.permissions.has('admin.super'),
        requestId: response.locals.requestId,
      }),
    });
}
