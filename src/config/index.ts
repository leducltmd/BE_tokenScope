import dotenv from 'dotenv';

dotenv.config();

/** Cấu hình ứng dụng đọc từ biến môi trường. */
export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  corsOrigins: (process.env.CORS_ORIGIN ?? '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
} as const;

export type AppConfig = typeof config;

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Kiểm tra một Origin có được phép gọi API hay không.
 *
 * Ngoài danh sách `CORS_ORIGIN` cố định, môi trường development còn cho
 * phép mọi origin `localhost`/`127.0.0.1` ở bất kỳ cổng nào — Flutter Web
 * dev server thường tự chọn cổng ngẫu nhiên nên danh sách cố định sẽ
 * chặn nhầm.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  if (config.corsOrigins.includes('*')) return true;
  if (config.corsOrigins.includes(origin)) return true;
  if (config.env !== 'production' && LOCALHOST_ORIGIN.test(origin)) return true;
  return false;
}
