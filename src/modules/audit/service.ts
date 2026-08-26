import { Prisma, type AuditOutcome } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Database } from '../../core/database.js';

export interface AuditInput {
  actorId?: string;
  platformId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome: AuditOutcome;
  reason?: string;
  requestId: string;
  ipHash?: string;
  metadata?: Record<string, unknown>;
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
const materialFor = (input: AuditInput, previousHash: string | null) => ({
  actorId: input.actorId ?? null,
  platformId: input.platformId ?? null,
  action: input.action,
  targetType: input.targetType ?? null,
  targetId: input.targetId ?? null,
  outcome: input.outcome,
  reason: input.reason ?? null,
  requestId: input.requestId,
  ipHash: input.ipHash ?? null,
  metadata: input.metadata ?? null,
  previousHash,
});

export class AuditService {
  constructor(private readonly db: Database) {}

  async record(input: AuditInput) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const previous = await tx.auditEvent.findFirst({ orderBy: { sequence: 'desc' } });
            const material = canonical(materialFor(input, previous?.integrityHash ?? null));
            const integrityHash = createHash('sha256').update(material).digest('hex');
            const event = await tx.auditEvent.create({
              data: {
                actorId: input.actorId,
                platformId: input.platformId,
                action: input.action,
                targetType: input.targetType,
                targetId: input.targetId,
                outcome: input.outcome,
                reason: input.reason,
                requestId: input.requestId,
                ipHash: input.ipHash,
                metadata: input.metadata as Prisma.InputJsonValue | undefined,
                previousHash: previous?.integrityHash,
                integrityHash,
              },
            });
            await tx.auditDelivery.create({ data: { auditEventId: event.id } });
            return event;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new Error('Audit persistence retry exhausted');
  }

  async list(input: {
    cursor?: string;
    limit: number;
    platformId?: string;
    actorId?: string;
    action?: string;
    outcome?: AuditOutcome;
    from?: Date;
    to?: Date;
    requestId?: string;
  }) {
    const rows = await this.db.auditEvent.findMany({
      where: {
        platformId: input.platformId,
        actorId: input.actorId,
        outcome: input.outcome,
        ...(input.action ? { action: { contains: input.action, mode: 'insensitive' } } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...((input.from || input.to) && { createdAt: { gte: input.from, lte: input.to } }),
      },
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, name: true, email: true } },
        platform: { select: { id: true, key: true, name: true } },
      },
    });
    const hasMore = rows.length > input.limit;
    if (hasMore) rows.pop();
    return {
      data: rows.map(({ sequence, ...row }) => ({ ...row, sequence: sequence.toString() })),
      nextCursor: hasMore ? rows.at(-1)?.id : undefined,
    };
  }

  async export(input: Omit<Parameters<AuditService['list']>[0], 'cursor' | 'limit'>) {
    const result = await this.list({ ...input, limit: 10_000 });
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const header = [
      'sequence',
      'createdAt',
      'action',
      'outcome',
      'actor',
      'platform',
      'targetType',
      'targetId',
      'reason',
      'requestId',
      'integrityHash',
    ];
    return [
      header.join(','),
      ...result.data.map((row) =>
        [
          row.sequence,
          row.createdAt.toISOString(),
          row.action,
          row.outcome,
          row.actor?.email,
          row.platform?.key,
          row.targetType,
          row.targetId,
          row.reason,
          row.requestId,
          row.integrityHash,
        ]
          .map(escape)
          .join(','),
      ),
    ].join('\n');
  }

  async verifyChain() {
    const rows = await this.db.auditEvent.findMany({ orderBy: { sequence: 'asc' } });
    let previousHash: string | null = null;
    for (const row of rows) {
      if ((row.previousHash ?? null) !== previousHash) return { valid: false, failedAt: row.id };
      const integrityHash: string = createHash('sha256')
        .update(
          canonical(
            materialFor(
              {
                actorId: row.actorId ?? undefined,
                platformId: row.platformId ?? undefined,
                action: row.action,
                targetType: row.targetType ?? undefined,
                targetId: row.targetId ?? undefined,
                outcome: row.outcome,
                reason: row.reason ?? undefined,
                requestId: row.requestId,
                ipHash: row.ipHash ?? undefined,
                metadata:
                  row.metadata && typeof row.metadata === 'object'
                    ? (row.metadata as Record<string, unknown>)
                    : undefined,
              },
              previousHash,
            ),
          ),
        )
        .digest('hex');
      if (integrityHash !== row.integrityHash) return { valid: false, failedAt: row.id };
      previousHash = row.integrityHash;
    }
    return { valid: true, events: rows.length, head: previousHash };
  }
}
