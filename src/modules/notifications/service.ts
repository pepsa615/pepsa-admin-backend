import { Prisma } from '@prisma/client';
import type { Database } from '../../core/database.js';
import { AppError } from '../../core/errors.js';

export class NotificationService {
  constructor(private readonly db: Database) {}

  create(input: {
    adminUserId: string;
    type: string;
    title: string;
    message: string;
    href?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.db.notification.create({
      data: {
        ...input,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  list(adminUserId: string, unreadOnly = false) {
    return this.db.notification.findMany({
      where: { adminUserId, ...(unreadOnly ? { status: 'UNREAD' } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(id: string, adminUserId: string) {
    const updated = await this.db.notification.updateMany({
      where: { id, adminUserId },
      data: { status: 'READ', readAt: new Date() },
    });
    if (!updated.count) throw new AppError(404, 'NOT_FOUND', 'Notification not found');
  }

  async markAllRead(adminUserId: string) {
    await this.db.notification.updateMany({
      where: { adminUserId, status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
  }
}
