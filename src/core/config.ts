import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65_535).default(3300),
  ADMIN_FRONTEND_ORIGIN: z.string().url().default('http://localhost:5174'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://postgres:postgres@localhost:5432/pepsa_admin'),
  SESSION_COOKIE_NAME: z.string().min(1).default('pepsa_admin_session'),
  SESSION_SECRET: z.string().min(16).default('development-session-secret-change-me'),
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .default('0'.repeat(64)),
  ACTOR_SIGNING_SECRET: z.string().min(16).default('development-actor-signing-secret'),
  METRICS_TOKEN: z.string().min(24).optional(),
  RECOVERY_DELIVERY_URL: z.string().url().optional(),
  RECOVERY_DELIVERY_TOKEN: z.string().min(24).optional(),
  SECURITY_MONITORING_URL: z.string().url().optional(),
  SECURITY_MONITORING_TOKEN: z.string().min(24).optional(),
  BUSINESS_SERVICE_BASE_URL: z.string().url().default('http://localhost:3200'),
  BUSINESS_SERVICE_AUDIENCE: z.string().min(1).default('pepsa-business-as-a-service'),
  PLATFORM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(5_000),
  PLATFORM_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
  PLATFORM_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(2).max(20).default(5),
  PLATFORM_CIRCUIT_OPEN_MS: z.coerce.number().int().positive().max(300_000).default(30_000),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().max(720).default(60),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().max(120).default(15),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.parse(source);

  if (parsed.NODE_ENV === 'production') {
    if (parsed.SESSION_SECRET.length < 32 || parsed.ACTOR_SIGNING_SECRET.length < 32)
      throw new Error('Production secrets must contain at least 32 characters');
    if (/^(0)+$/.test(parsed.MFA_ENCRYPTION_KEY)) throw new Error('MFA_ENCRYPTION_KEY is insecure');
    if (!parsed.METRICS_TOKEN) throw new Error('METRICS_TOKEN is required in production');
    if (!parsed.RECOVERY_DELIVERY_URL || !parsed.RECOVERY_DELIVERY_TOKEN)
      throw new Error('Password recovery delivery is required in production');
    if (!parsed.SECURITY_MONITORING_URL || !parsed.SECURITY_MONITORING_TOKEN)
      throw new Error('Security monitoring delivery is required in production');
  }

  return {
    environment: parsed.NODE_ENV,
    port: parsed.PORT,
    frontendOrigin: parsed.ADMIN_FRONTEND_ORIGIN,
    databaseUrl: parsed.DATABASE_URL,
    session: {
      cookieName: parsed.SESSION_COOKIE_NAME,
      secret: parsed.SESSION_SECRET,
      ttlMs: parsed.SESSION_TTL_MINUTES * 60_000,
      idleMs: parsed.SESSION_IDLE_MINUTES * 60_000,
      secure: parsed.NODE_ENV === 'production',
      // The production UI and API are deployed on separate Render subdomains.
      // onrender.com is a public suffix, so those origins are cross-site and
      // require SameSite=None for credentialed requests.
      sameSite: parsed.NODE_ENV === 'production' ? ('none' as const) : ('strict' as const),
    },
    mfaEncryptionKey: Buffer.from(parsed.MFA_ENCRYPTION_KEY, 'hex'),
    actorSigningSecret: parsed.ACTOR_SIGNING_SECRET,
    metricsToken: parsed.METRICS_TOKEN,
    recoveryDelivery: parsed.RECOVERY_DELIVERY_URL
      ? { url: parsed.RECOVERY_DELIVERY_URL, token: parsed.RECOVERY_DELIVERY_TOKEN! }
      : undefined,
    securityMonitoring: parsed.SECURITY_MONITORING_URL
      ? { url: parsed.SECURITY_MONITORING_URL, token: parsed.SECURITY_MONITORING_TOKEN! }
      : undefined,
    businessService: {
      baseUrl: parsed.BUSINESS_SERVICE_BASE_URL,
      audience: parsed.BUSINESS_SERVICE_AUDIENCE,
      timeoutMs: parsed.PLATFORM_REQUEST_TIMEOUT_MS,
      retryAttempts: parsed.PLATFORM_RETRY_ATTEMPTS,
      circuitFailureThreshold: parsed.PLATFORM_CIRCUIT_FAILURE_THRESHOLD,
      circuitOpenMs: parsed.PLATFORM_CIRCUIT_OPEN_MS,
    },
  } as const;
}
