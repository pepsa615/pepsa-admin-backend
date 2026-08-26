import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${digest.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function encrypt(value: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decrypt(value: string, key: Buffer) {
  const [ivValue, tagValue, ciphertextValue] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue!, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue!, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue!, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function createTotpSecret() {
  let bits = '';
  for (const byte of randomBytes(20)) bits += byte.toString(2).padStart(8, '0');
  return bits
    .match(/.{1,5}/g)!
    .map((chunk) => alphabet[Number.parseInt(chunk.padEnd(5, '0'), 2)])
    .join('');
}

function decodeBase32(value: string) {
  const bits = [...value.toUpperCase().replace(/=+$/, '')]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0'))
    .join('');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
}

function totp(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, now = Date.now()) {
  const step = Math.floor(now / 30_000);
  return [-1, 0, 1].some((offset) => {
    const expected = Buffer.from(totp(secret, step + offset));
    const actual = Buffer.from(code);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

export function signActorContext(payload: Record<string, unknown>, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
