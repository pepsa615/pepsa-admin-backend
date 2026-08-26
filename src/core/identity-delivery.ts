import { AppError } from './errors.js';

export interface IdentityDeliveryConfig {
  url: string;
  token: string;
}

export async function deliverIdentityToken(
  delivery: IdentityDeliveryConfig | undefined,
  input: {
    email: string;
    token: string;
    purpose: 'admin-invitation' | 'password-recovery';
    expiresInMinutes: number;
    requestId: string;
    failureCode: string;
    failureMessage: string;
  },
) {
  if (!delivery) return false;
  const response = await fetch(delivery.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${delivery.token}`,
      'content-type': 'application/json',
      'x-request-id': input.requestId,
    },
    body: JSON.stringify({
      email: input.email,
      token: input.token,
      purpose: input.purpose,
      expiresInMinutes: input.expiresInMinutes,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new AppError(503, input.failureCode, input.failureMessage);
  return true;
}
