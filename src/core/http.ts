import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { AppError } from './errors.js';
import { logger } from './logger.js';

export const asyncHandler =
  (handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) =>
    Promise.resolve(handler(request, response, next)).catch(next);

export function requestContext(request: Request, response: Response, next: NextFunction) {
  const suppliedRequestId = request.header('x-request-id')?.trim();
  const requestId =
    suppliedRequestId && /^[a-zA-Z0-9_.:-]{8,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();

  response.locals.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}

export function notFound(request: Request, response: Response) {
  response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.path} was not found`,
      requestId: response.locals.requestId,
    },
  });
}

export function errorHandler(
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
) {
  const normalized =
    error instanceof ZodError
      ? new AppError(422, 'VALIDATION_ERROR', 'Request validation failed', error.flatten())
      : error instanceof AppError
        ? error
        : new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  if (normalized.status >= 500)
    logger.error(
      { err: error, requestId: response.locals.requestId, path: request.path },
      normalized.message,
    );
  response.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
      requestId: response.locals.requestId,
    },
  });
}
