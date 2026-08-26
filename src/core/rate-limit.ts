import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { sha256 } from './crypto.js';
import type { Database } from './database.js';
import { AppError } from './errors.js';

export function rateLimit(
  db: Database,
  options: { windowMs: number; limit: number; namespace?: string },
) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const key = `${options.namespace ?? 'http'}:${sha256(request.ip ?? 'unknown')}`;
      const now = new Date();
      let bucket;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          bucket = await db.$transaction(
            async (tx) => {
              const current = await tx.rateLimitBucket.findUnique({ where: { key } });
              if (!current || current.resetAt <= now)
                return tx.rateLimitBucket.upsert({
                  where: { key },
                  create: { key, count: 1, resetAt: new Date(now.getTime() + options.windowMs) },
                  update: { count: 1, resetAt: new Date(now.getTime() + options.windowMs) },
                });
              return tx.rateLimitBucket.update({
                where: { key },
                data: { count: { increment: 1 } },
              });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
          break;
        } catch (error) {
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            error.code !== 'P2034' ||
            attempt === 2
          )
            throw error;
        }
      }
      if (!bucket) throw new Error('Rate limit persistence failed');
      response.setHeader('ratelimit-limit', options.limit);
      response.setHeader('ratelimit-remaining', Math.max(0, options.limit - bucket.count));
      response.setHeader('ratelimit-reset', Math.ceil(bucket.resetAt.getTime() / 1_000));
      if (bucket.count > options.limit)
        return next(new AppError(429, 'RATE_LIMITED', 'Too many requests'));
      next();
    } catch (error) {
      next(error);
    }
  };
}
