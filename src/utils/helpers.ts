import { randomBytes } from 'node:crypto';

/** Sinh chuỗi ngẫu nhiên an toàn dùng làm refresh token. */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('hex');
}

/** Chuẩn hóa email về dạng lowercase, bỏ khoảng trắng thừa. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Chuẩn hóa họ tên: bỏ khoảng trắng thừa, viết hoa chữ cái đầu mỗi từ.
 */
export function normalizeName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) =>
      word.length === 0
        ? word
        : word.charAt(0).toLocaleUpperCase('vi-VN') +
          word.slice(1).toLocaleLowerCase('vi-VN'),
    )
    .join(' ');
}

/** Che bốn ký tự cuối của API key, phần còn lại hiển thị dạng dấu chấm. */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return '••••';
  return `${'•'.repeat(8)}${apiKey.slice(-4)}`;
}
