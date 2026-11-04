import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import { config } from '../config';

/**
 * Mã hoá API key của nhà cung cấp bằng AES-256-GCM.
 *
 * - `iv` (12 byte) và `authTag` (16 byte) được sinh ngẫu nhiên cho mỗi lần mã hoá
 *   và lưu kèm ciphertext, dạng `iv.tag.ciphertext` (base64url).
 * - Khoá thực tế được dẫn xuất từ `API_KEY_ENCRYPTION_SECRET` bằng `scrypt`
 *   nên không cần quản lý khoá 32 byte thủ công.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

/** Cache khoá đã dẫn xuất để không tính lại scrypt cho mỗi lần gọi. */
let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret =
    config.security.apiKeyEncryptionSecret ||
    config.jwt.accessSecret ||
    'dev-api-key-secret';
  cachedKey = scryptSync(secret, 'tokenscope-api-key-salt', KEY_LENGTH);
  return cachedKey;
}

/** Mã hoá một chuỗi bí mật (API key). */
export function encryptSecret(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

/** Giải mã chuỗi đã mã hoá bởi [encryptSecret]. */
export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('Định dạng API key đã mã hoá không hợp lệ.');
  }
  const [ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
