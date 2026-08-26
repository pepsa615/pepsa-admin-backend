import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errors.js';

const requests = new Map<string, number>();
const durations = new Map<string, { count: number; totalMs: number }>();
const normalize = (path: string) =>
  path
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/operations\/[^/]+\/[^/]+/, '/operations/:platform/:operation');

export function metricsMiddleware(request: Request, response: Response, next: NextFunction) {
  const started = performance.now();
  response.once('finish', () => {
    const route = normalize(request.path);
    const key = `${request.method}|${route}|${response.statusCode}`;
    requests.set(key, (requests.get(key) ?? 0) + 1);
    const duration = durations.get(key) ?? { count: 0, totalMs: 0 };
    duration.count += 1;
    duration.totalMs += performance.now() - started;
    durations.set(key, duration);
  });
  next();
}

export const metricsHandler = (token?: string) => (request: Request, response: Response) => {
  if (!token || request.header('authorization') !== `Bearer ${token}`)
    throw new AppError(401, 'UNAUTHENTICATED', 'Metrics credential required');
  const lines = [
    '# HELP pepsa_admin_http_requests_total Total HTTP requests.',
    '# TYPE pepsa_admin_http_requests_total counter',
  ];
  for (const [key, count] of requests) {
    const [method, route, status] = key.split('|');
    const labels = `method="${method}",route="${route}",status="${status}"`;
    lines.push(`pepsa_admin_http_requests_total{${labels}} ${count}`);
    const duration = durations.get(key)!;
    lines.push(`pepsa_admin_http_request_duration_ms_sum{${labels}} ${duration.totalMs}`);
    lines.push(`pepsa_admin_http_request_duration_ms_count{${labels}} ${duration.count}`);
  }
  response.type('text/plain; version=0.0.4').send(`${lines.join('\n')}\n`);
};
