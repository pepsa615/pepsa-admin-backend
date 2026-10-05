#!/usr/bin/env node
/**
 * Post-deploy staging smoke:
 * 1) Admin control-plane health (live + ready)
 * 2) One pepsa-order read with a signed actor token (fleet-health)
 * 3) One pepsa-payment read with a signed actor token (sva-provisioning-list)
 *
 * Required when enabled: ADMIN_STAGING_URL, ACTOR_SIGNING_SECRET,
 * ORDER_SERVICE_BASE_URL, PAYMENT_SERVICE_BASE_URL.
 * Optional: ORDER_SERVICE_AUDIENCE (default pepsa-order),
 * PAYMENT_SERVICE_AUDIENCE (default pepsa-payment).
 */
import { createHmac, randomUUID } from 'node:crypto';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required env ${name}`);
    process.exit(1);
  }
  return value;
}

function signActor(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

async function getJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* keep text */
  }
  return { status: response.status, ok: response.ok, body };
}

function mintToken({ audience, platform, permission, secret }) {
  const now = Math.floor(Date.now() / 1000);
  return signActor(
    {
      iss: 'pepsa-admin',
      aud: audience,
      sub: 'staging-smoke',
      platform,
      platformId: 'staging-smoke',
      permissions: [permission],
      requestId: randomUUID(),
      jti: randomUUID(),
      iat: now,
      exp: now + 60,
    },
    secret,
  );
}

const adminBase = required('ADMIN_STAGING_URL').replace(/\/$/, '');
const actorSecret = required('ACTOR_SIGNING_SECRET');
const orderBase = required('ORDER_SERVICE_BASE_URL').replace(/\/$/, '');
const paymentBase = required('PAYMENT_SERVICE_BASE_URL').replace(/\/$/, '');
const orderAudience = process.env.ORDER_SERVICE_AUDIENCE?.trim() || 'pepsa-order';
const paymentAudience = process.env.PAYMENT_SERVICE_AUDIENCE?.trim() || 'pepsa-payment';

const live = await getJson(`${adminBase}/admin-api/v1/health/live`);
if (!live.ok) {
  console.error('Admin health/live failed', live.status, live.body);
  process.exit(1);
}
console.log('OK admin health/live');

const ready = await getJson(`${adminBase}/admin-api/v1/health/ready`);
if (!ready.ok) {
  console.error('Admin health/ready failed', ready.status, ready.body);
  process.exit(1);
}
console.log('OK admin health/ready');

const orderToken = mintToken({
  audience: orderAudience,
  platform: 'pepsa-order',
  permission: 'order.fleet.read',
  secret: actorSecret,
});
const order = await getJson(`${orderBase}/internal/v1/fleet/health`, {
  headers: {
    authorization: `Bearer ${orderToken}`,
    'x-request-id': randomUUID(),
  },
});
if (!order.ok) {
  console.error('Order fleet-health failed', order.status, order.body);
  process.exit(1);
}
console.log('OK pepsa-order fleet-health (actor token)');

const paymentToken = mintToken({
  audience: paymentAudience,
  platform: 'pepsa-payment',
  permission: 'payment.sva.provisioning.read',
  secret: actorSecret,
});
const payment = await getJson(`${paymentBase}/v1/admin/sva-provisioning`, {
  headers: {
    authorization: `Bearer ${paymentToken}`,
    'x-request-id': randomUUID(),
  },
});
if (!payment.ok) {
  console.error('Payment sva-provisioning-list failed', payment.status, payment.body);
  process.exit(1);
}
console.log('OK pepsa-payment sva-provisioning-list (actor token)');
console.log('Staging smoke passed.');
