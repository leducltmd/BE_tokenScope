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

  security: {
    /** Khoá dùng để mã hoá API key của nhà cung cấp trong database. */
    apiKeyEncryptionSecret:
      process.env.API_KEY_ENCRYPTION_SECRET ?? 'dev-api-key-encryption-secret',
  },

  /** Thời gian chờ tối đa khi gọi API của nhà cung cấp bên ngoài (ms). */
  providerRequestTimeoutMs: Number(
    process.env.PROVIDER_REQUEST_TIMEOUT_MS ?? 15_000,
  ),

  /**
   * Cấu hình Anthropic Claude.
   *
   * - `apiKey` — Secret API Key (`ANTHROPIC_API_KEY`): dùng cho các API thông
   *   thường của Claude — kiểm tra kết nối, đọc danh sách model, gọi model.
   * - `adminApiKey` — Admin API Key (`ANTHROPIC_ADMIN_API_KEY`): dùng **chỉ** cho
   *   các endpoint quản trị tổ chức:
   *   - `/v1/organizations/usage_report/messages`
   *   - `/v1/organizations/cost_report`
   *
   *   Secret API Key không thay thế được cho Admin API Key — Anthropic từ chối
   *   với mã 401/403.
   * - `workspaceId` — Workspace ID (`ANTHROPIC_WORKSPACE_ID`, `wsp_...`): tuỳ
   *   chọn, dùng làm header `anthropic-workspace-id` khi Secret API Key chưa
   *   được scope vào Workspace nào. Không bao giờ hardcode trong mã nguồn.
   *
   * Tất cả chỉ tồn tại ở backend — không trả về frontend, không ghi log.
   */
  anthropic: {
    apiKey: (process.env.ANTHROPIC_API_KEY ?? '').trim(),
    adminApiKey: (process.env.ANTHROPIC_ADMIN_API_KEY ?? '').trim(),
    workspaceId: (process.env.ANTHROPIC_WORKSPACE_ID ?? '').trim(),
    baseUrl: (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(
      /\/+$/,
      '',
    ),
  },

  /**
   * Cấu hình Admin Dashboard.
   *
   * - `adminEmails` — danh sách email được coi là admin **kể cả khi role
   *   trong DB chưa được đặt**. Tiện cho môi trường demo/lab.
   * - `allowAdminByEmail` — bật/tắt cơ chế fallback bằng email.
   */
  admin: {
    adminEmails: (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    allowAdminByEmail:
      (process.env.ADMIN_ALLOW_BY_EMAIL ?? 'true').toLowerCase() === 'true',
  },

  /**
   * Cấu hình Crash Testing (chỉ dùng cho môi trường demo/testing).
   *
   * - `enabled` — bật/tắt toàn bộ tính năng. Mặc định tắt ở production.
   * - `allowedEnvironments` — danh sách môi trường được phép kích hoạt crash.
   */
  crashTesting: {
    enabled:
      (process.env.CRASH_TESTING_ENABLED ?? 'false').toLowerCase() === 'true',
    allowedEnvironments: (process.env.CRASH_TESTING_ENVIRONMENTS ?? 'development,staging,test,demo')
      .split(',')
      .map((env) => env.trim().toLowerCase())
      .filter(Boolean),
  },

  /**
   * Cấu hình Firebase Analytics (GA4 Data API).
   *
   * Dùng để đọc số liệu hành vi người dùng (app open, session, event) trực
   * tiếp từ Firebase. Nếu thiếu `propertyId` hoặc `credentials` thì API
   * `admin/analytics/firebase` sẽ trả về trạng thái "chưa cấu hình" — phần
   * còn lại của Admin Dashboard vẫn hoạt động bình thường.
   */
  analytics: {
    propertyId: (process.env.FIREBASE_ANALYTICS_PROPERTY_ID ?? '').trim(),
    /**
     * Service account JSON (đọc từ file khi biến trỏ tới đường dẫn,
     * hoặc nội dung JSON thô).
     */
    credentials:
      (process.env.FIREBASE_ANALYTICS_CREDENTIALS ?? '').trim() ||
      (process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim(),
  },

  /**
   * Cấu hình Firebase Crashlytics (chỉ đọc trạng thái).
   *
   * Crashlytics không có API đọc số liệu công khai — dữ liệu được xem trực
   * tiếp trên Firebase Console. Backend chỉ cung cấấp trạng thái cấu hình
   * và các yêu cầu crash test do Admin phát ra.
   */
  crashlytics: {
    projectId: (process.env.FIREBASE_PROJECT_ID ?? 'tokenscope-5116d').trim(),
  },

  /**
   * Cấu hình OpenAI.
   *
   * - `apiKey` — Secret API Key (`OPENAI_API_KEY`): dùng để đọc danh sách model
   *   và gọi model. Không dùng để truy vấn Usage/Costs.
   * - `adminApiKey` — Admin API Key (`OPENAI_ADMIN_API_KEY`): dùng để truy vấn
   *   Organization Usage & Costs. Chỉ tồn tại ở backend, không lưu database,
   *   không trả về frontend và không ghi log.
   */
  openai: {
    apiKey: (process.env.OPENAI_API_KEY ?? '').trim(),
    adminApiKey: (process.env.OPENAI_ADMIN_API_KEY ?? '').trim(),
    baseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com').replace(
      /\/+$/,
      '',
    ),
    /**
     * Bật/tắt việc đọc dữ liệu cấp Organization (Usage & Costs).
     *
     * Dữ liệu này là của toàn tổ chức nên có thể nhìn thấy hoạt động của các
     * thành viên khác — mặc định tắt, chỉ bật khi chủ dự án đồng ý.
     *
     * Đọc trực tiếp từ `process.env` mỗi lần kiểm tra để việc bật/tắt có
     * hiệu lực ngay, không cần khởi động lại backend.
     */
    orgAccessEnabled:
      (process.env.OPENAI_ORG_ACCESS_ENABLED ?? 'false').toLowerCase() === 'true',
    /**
     * Danh sách userId được phép đọc dữ liệu Organization (rỗng = tất cả user
     * đã đăng nhập, chỉ áp dụng khi `orgAccessEnabled` bật).
     */
    orgAllowedUserIds: (process.env.OPENAI_ORG_ALLOWED_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  },
} as const;

export type AppConfig = typeof config;

/**
 * Cờ bật đọc dữ liệu Usage/Costs cấp tổ chức — đọc live từ biến môi trường.
 */
export function isOrgAccessEnabled(): boolean {
  return (
    (process.env.OPENAI_ORG_ACCESS_ENABLED ?? 'false').toLowerCase() === 'true'
  );
}

/**
 * Danh sách userId được phép đọc dữ liệu Organization — đọc live.
 */
export function getOrgAllowedUserIds(): string[] {
  return (process.env.OPENAI_ORG_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Kiểm tra một email có nằm trong danh sách admin được cấu hình hay không.
 */
export function isAdminEmail(email: string): boolean {
  if (!config.admin.allowAdminByEmail) return false;
  return config.admin.adminEmails.includes(email.trim().toLowerCase());
}

/**
 * Kiểm tra môi trường hiện tại có được phép kích hoạt crash test hay không.
 *
 * Ở `production` luôn trả về `false` — crash test chỉ dùng cho demo/testing.
 */
export function isCrashTestingAllowed(environment?: string): boolean {
  if (!config.crashTesting.enabled) return false;
  const env = (environment ?? config.env).trim().toLowerCase();
  if (env === 'production') return false;
  return config.crashTesting.allowedEnvironments.includes(env);
}

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
