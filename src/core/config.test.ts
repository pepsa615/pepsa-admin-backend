import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('session cookie configuration', () => {
  it('uses strict same-site cookies outside production', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).session).toMatchObject({
      secure: false,
      sameSite: 'strict',
      partitioned: false,
    });
  });

  it('allows credentialed requests between production Render subdomains', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 's'.repeat(32),
      ACTOR_SIGNING_SECRET: 'a'.repeat(32),
      MFA_ENCRYPTION_KEY: '1'.repeat(64),
      METRICS_TOKEN: 'm'.repeat(24),
      RECOVERY_DELIVERY_URL: 'https://recovery.example.com',
      RECOVERY_DELIVERY_TOKEN: 'r'.repeat(24),
      SECURITY_MONITORING_URL: 'https://monitoring.example.com',
      SECURITY_MONITORING_TOKEN: 't'.repeat(24),
    });

    expect(config.session).toMatchObject({
      secure: true,
      sameSite: 'none',
      partitioned: true,
    });
  });
});

describe('platform service configuration', () => {
  it('exposes order and payment service blocks with shared resilience knobs', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      ORDER_SERVICE_BASE_URL: 'http://localhost:3100',
      ORDER_SERVICE_AUDIENCE: 'pepsa-order',
      PAYMENT_SERVICE_BASE_URL: 'http://localhost:3400',
      PAYMENT_SERVICE_AUDIENCE: 'pepsa-payment',
      PLATFORM_REQUEST_TIMEOUT_MS: '4000',
      PLATFORM_RETRY_ATTEMPTS: '1',
      PLATFORM_CIRCUIT_FAILURE_THRESHOLD: '3',
      PLATFORM_CIRCUIT_OPEN_MS: '15000',
    });

    expect(config.orderService).toEqual({
      baseUrl: 'http://localhost:3100',
      audience: 'pepsa-order',
      timeoutMs: 4000,
      retryAttempts: 1,
      circuitFailureThreshold: 3,
      circuitOpenMs: 15000,
    });
    expect(config.paymentService).toEqual({
      baseUrl: 'http://localhost:3400',
      audience: 'pepsa-payment',
      timeoutMs: 4000,
      retryAttempts: 1,
      circuitFailureThreshold: 3,
      circuitOpenMs: 15000,
    });
  });
});
