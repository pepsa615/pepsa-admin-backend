import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../../core/config.js';
import { AppError } from '../../core/errors.js';
import type { AuthService } from './service.js';
import type { AuthorizationMiddleware } from './middleware.js';

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(12).max(200),
});
const mfaSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const recoverySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/),
});
const resetRequestSchema = z.object({ email: z.string().email().max(320) });
const resetSchema = z.object({
  token: z.string().min(32).max(200),
  password: z.string().min(14).max(200),
  mfaCode: z
    .string()
    .regex(/^\d{6}$/)
    .default('000000'),
});

export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly auth: AuthorizationMiddleware,
    private readonly config: AppConfig,
  ) {}
  private setCookie(response: Response, token: string) {
    response.cookie(this.config.session.cookieName, token, {
      httpOnly: true,
      secure: this.config.session.secure,
      sameSite: this.config.session.sameSite,
      path: '/admin-api/v1',
      maxAge: this.config.session.ttlMs,
    });
  }
  login = async (request: Request, response: Response) => {
    const body = loginSchema.parse(request.body);
    const result = await this.service.login({
      ...body,
      requestId: response.locals.requestId,
      ipHash: request.ip ? createHash('sha256').update(request.ip).digest('hex') : undefined,
      userAgent: request.header('user-agent'),
    });
    this.setCookie(response, result.sessionToken);
    response.status(202).json({ data: { requiresMfa: true, enrollment: result.enrollment } });
  };
  requestPasswordReset = async (request: Request, response: Response) => {
    const result = await this.service.requestPasswordReset({
      ...resetRequestSchema.parse(request.body),
      requestId: response.locals.requestId,
    });
    response.status(202).json({ data: result });
  };
  resetPassword = async (request: Request, response: Response) => {
    await this.service.resetPassword({
      ...resetSchema.parse(request.body),
      requestId: response.locals.requestId,
    });
    response.status(204).end();
  };
  verifyMfa = async (request: Request, response: Response) => {
    const token = this.auth.sessionToken(request);
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
    const result = await this.service.verifyMfa({
      sessionToken: token,
      code: mfaSchema.parse(request.body).code,
      requestId: response.locals.requestId,
    });
    response.json({ data: result });
  };
  recoverMfa = async (request: Request, response: Response) => {
    const token = this.auth.sessionToken(request);
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
    const result = await this.service.recoverMfa({
      sessionToken: token,
      code: recoverySchema.parse(request.body).code,
      requestId: response.locals.requestId,
    });
    response.json({ data: result });
  };
  session = async (request: Request, response: Response) => {
    response.json({
      data: {
        user: { id: request.admin!.id, email: request.admin!.email, name: request.admin!.name },
        permissions: [...request.admin!.permissions],
      },
    });
  };
  csrf = async (request: Request, response: Response) =>
    response.json({ data: { csrfToken: await this.service.issueCsrf(request.admin!.sessionId) } });
  stepUp = async (request: Request, response: Response) => {
    await this.service.stepUp({
      sessionId: request.admin!.sessionId,
      actorId: request.admin!.id,
      code: mfaSchema.parse(request.body).code,
      requestId: response.locals.requestId,
    });
    response.status(204).end();
  };
  logout = async (request: Request, response: Response) => {
    await this.service.logout(
      request.admin!.sessionId,
      request.admin!.id,
      response.locals.requestId,
    );
    response.clearCookie(this.config.session.cookieName, {
      httpOnly: true,
      secure: this.config.session.secure,
      sameSite: this.config.session.sameSite,
      path: '/admin-api/v1',
    });
    response.status(204).end();
  };
}
