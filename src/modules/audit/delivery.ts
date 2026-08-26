import type { AppConfig } from '../../core/config.js';
import type { Database } from '../../core/database.js';

const sensitive = /password|token|secret|authorization|cookie|api.?key/i;
const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        sensitive.test(key) ? '[REDACTED]' : redact(child),
      ]),
    );
  return value;
};

export class AuditDeliveryService {
  constructor(
    private readonly db: Database,
    private readonly destination: AppConfig['securityMonitoring'],
  ) {}

  async processNext() {
    if (!this.destination) return false;
    const pending = await this.db.auditDelivery.findFirst({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { event: { sequence: 'asc' } },
      include: { event: true },
    });
    if (!pending) return false;
    const claim = await this.db.auditDelivery.updateMany({
      where: { id: pending.id, status: 'PENDING' },
      data: { status: 'RUNNING', attempts: { increment: 1 } },
    });
    if (!claim.count) return true;
    try {
      const response = await fetch(this.destination.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.destination.token}`,
          'content-type': 'application/json',
          'idempotency-key': pending.auditEventId,
          'x-request-id': pending.event.requestId,
        },
        body: JSON.stringify({
          id: pending.event.id,
          sequence: pending.event.sequence.toString(),
          actorId: pending.event.actorId,
          platformId: pending.event.platformId,
          action: pending.event.action,
          targetType: pending.event.targetType,
          targetId: pending.event.targetId,
          outcome: pending.event.outcome,
          reason: pending.event.reason,
          requestId: pending.event.requestId,
          metadata: redact(pending.event.metadata),
          integrityHash: pending.event.integrityHash,
          previousHash: pending.event.previousHash,
          createdAt: pending.event.createdAt,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Security sink returned ${response.status}`);
      await this.db.auditDelivery.update({
        where: { id: pending.id },
        data: { status: 'SUCCEEDED', deliveredAt: new Date(), lastError: null },
      });
    } catch (error) {
      const attempts = pending.attempts + 1;
      await this.db.auditDelivery.update({
        where: { id: pending.id },
        data: {
          status: attempts >= 10 ? 'FAILED' : 'PENDING',
          nextAttemptAt: new Date(Date.now() + Math.min(300_000, 1_000 * 2 ** attempts)),
          lastError: error instanceof Error ? error.message.slice(0, 300) : 'Delivery failed',
        },
      });
    }
    return true;
  }

  async lag() {
    const oldest = await this.db.auditDelivery.findFirst({
      where: { status: { in: ['PENDING', 'RUNNING', 'FAILED'] } },
      orderBy: { event: { sequence: 'asc' } },
      include: { event: { select: { createdAt: true } } },
    });
    return oldest ? Date.now() - oldest.event.createdAt.getTime() : 0;
  }
}
