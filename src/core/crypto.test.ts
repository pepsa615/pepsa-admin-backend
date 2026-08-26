import { describe, expect, it } from 'vitest';
import {
  createTotpSecret,
  decrypt,
  encrypt,
  hashPassword,
  signActorContext,
  verifyPassword,
} from './crypto.js';

describe('security primitives', () => {
  it('hashes passwords with a random salt', async () => {
    const first = await hashPassword('a-very-long-test-password');
    const second = await hashPassword('a-very-long-test-password');
    expect(first).not.toBe(second);
    expect(await verifyPassword('a-very-long-test-password', first)).toBe(true);
    expect(await verifyPassword('incorrect-password', first)).toBe(false);
  }, 20_000);
  it('encrypts MFA secrets at rest', () => {
    const key = Buffer.alloc(32, 7);
    const secret = createTotpSecret();
    const ciphertext = encrypt(secret, key);
    expect(ciphertext).not.toContain(secret);
    expect(decrypt(ciphertext, key)).toBe(secret);
  });
  it('creates a three-part signed actor context', () => {
    expect(signActorContext({ sub: 'admin-id', exp: 1 }, 'a-secret-with-enough-entropy')).toMatch(
      /^[^.]+\.[^.]+\.[^.]+$/,
    );
  });
});
