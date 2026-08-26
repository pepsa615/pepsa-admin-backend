import type { Request, Response } from 'express';
import type { NotificationService } from './service.js';

export class NotificationController {
  constructor(private readonly service: NotificationService) {}
  list = async (request: Request, response: Response) =>
    response.json({
      data: await this.service.list(request.admin!.id, request.query.unread === 'true'),
    });
  read = async (request: Request, response: Response) => {
    await this.service.markRead(String(request.params.id), request.admin!.id);
    response.status(204).end();
  };
  readAll = async (request: Request, response: Response) => {
    await this.service.markAllRead(request.admin!.id);
    response.status(204).end();
  };
}
