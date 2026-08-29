import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig } from './core/config.js';

const app = createApp(loadConfig({ NODE_ENV: 'test' }));

describe('admin API foundation', () => {
  it('reports liveness', async () => {
    const response = await request(app).get('/admin-api/v1/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'pepsa-admin-backend' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('uses the standard not-found response', async () => {
    const response = await request(app).get('/missing');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('allows PUT in CORS preflight for membership updates', async () => {
    const response = await request(app)
      .options('/admin-api/v1/administrators/example-user/membership')
      .set('Origin', 'http://localhost:5174')
      .set('Access-Control-Request-Method', 'PUT');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-methods']).toMatch(/PUT/);
  });
});
