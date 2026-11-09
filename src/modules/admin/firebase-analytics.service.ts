import crypto from 'node:crypto';
import fs from 'node:fs';

import { config } from '../../config';

/**
 * Client đọc số liệu Firebase Analytics (GA4 Data API).
 *
 * Cố tình KHÔNG thêm dependency `googleapis` — việc ký JWT bằng `node:crypto`
 * và gọi REST API giúp backend nhẹ hơn và không ảnh hưởng tới các module
 * đang hoạt động (OpenAI / Anthropic / Google).
 *
 * Yêu cầu cấu hình trong `.env`:
 * - `FIREBASE_ANALYTICS_PROPERTY_ID` — dạng `properties/123456789`
 * - `FIREBASE_ANALYTICS_CREDENTIALS` — service account JSON (nội dung thô
 *   hoặc đường dẫn tới file JSON)
 *
 * Nếu thiếu cấu hình, mọi hàm trả về `configured: false` để Admin Web hiển
 * thị thông báo thay vì lỗi 500.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/** Kết quả chuẩn hoá cho mọi lời gọi tới Firebase Analytics. */
export interface FirebaseAnalyticsResult<T> {
  configured: boolean;
  /** Lý do không đọc được dữ liệu (nếu có). */
  message?: string;
  data?: T;
}

/** Service account đã parse. */
interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** Cache access token để không ký lại mỗi request. */
let cachedToken: { value: string; expiresAt: number } | null = null;

/** Đọc service account từ biến môi trường (JSON thô hoặc đường dẫn file). */
function readServiceAccount(): ServiceAccount | null {
  const raw = config.analytics.credentials;
  if (!raw) return null;

  const json = raw.startsWith('{')
    ? raw
    : (() => {
        try {
          if (!fs.existsSync(raw)) return null;
          return fs.readFileSync(raw, 'utf8');
        } catch {
          return null;
        }
      })();

  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Base64url encode — không phụ thuộc Buffer API khác version. */
function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Lấy access token OAuth2 từ service account (có cache). */
async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const account = readServiceAccount();
  if (!account) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: account.token_uri ?? TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claim}`)
    .sign(account.private_key);

  const assertion = `${header}.${claim}.${base64url(signature)}`;

  try {
    const response = await fetch(account.token_uri ?? TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;

    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
    };
    return cachedToken.value;
  } catch {
    return null;
  }
}

/** Chuẩn hoá property id về dạng `properties/123456789`. */
function normalizePropertyId(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  return value.startsWith('properties/') ? value : `properties/${value}`;
}

export interface FirebaseAnalyticsSummary {
  propertyId: string;
  rangeStartDate: string;
  rangeEndDate: string;
  /** Tổng số lượt mở ứng dụng (event `app_open` hoặc `first_open`). */
  appOpens: number;
  /** Số người dùng hoạt động (active users). */
  activeUsers: number;
  /** Tổng số phiên sử dụng. */
  sessions: number;
  /** Tổng số sự kiện phát sinh. */
  totalEvents: number;
  /** Người dùng mới trong khoảng. */
  newUsers: number;
  /** Sự kiện tính năng đã ghi nhận (đếm theo tên sự kiện). */
  featureEvents: {
    name: string;
    count: number;
    users: number;
  }[];
  /** Trung bình số phiên trên mỗi người dùng. */
  sessionsPerUser: number;
}

interface Ga4Row {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}

interface Ga4Report {
  rows?: Ga4Row[];
  totals?: Ga4Row[];
  rowCount?: number;
}

/** Gọi GA4 Data API `runReport`. */
async function runReport(
  body: Record<string, unknown>,
): Promise<Ga4Report | null> {
  const propertyId = normalizePropertyId(config.analytics.propertyId);
  const token = await getAccessToken();
  if (!propertyId || !token) return null;

  try {
    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) return null;
    return (await response.json()) as Ga4Report;
  } catch {
    return null;
  }
}

/** Đọc giá trị metric đầu tiên của một hàng. */
function metric(row: Ga4Row | undefined, index: number): number {
  const value = row?.metricValues?.[index]?.value;
  return value ? Number(value) : 0;
}

/** Đọc giá trị dimension đầu tiên của một hàng. */
function dimension(row: Ga4Row | undefined, index: number): string {
  return row?.dimensionValues?.[index]?.value ?? '';
}

/**
 * Tổng hợp số liệu Firebase Analytics cho Admin Web.
 *
 * @param days Khoảng thống kê (tối đa 90 ngày).
 */
export async function getFirebaseAnalyticsSummary(
  days = 30,
): Promise<FirebaseAnalyticsResult<FirebaseAnalyticsSummary>> {
  const propertyId = normalizePropertyId(config.analytics.propertyId);
  const hasCredentials = Boolean(config.analytics.credentials);

  if (!propertyId || !hasCredentials) {
    return {
      configured: false,
      message:
        'Firebase Analytics chưa được cấu hình. Thiết lập FIREBASE_ANALYTICS_PROPERTY_ID và FIREBASE_ANALYTICS_CREDENTIALS trong file .env của backend.',
    };
  }

  const safeDays = Math.min(Math.max(days, 1), 90);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - safeDays);

  const range = {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
  };

  const [appOpenReport, activeReport, sessionReport, eventReport, newUserReport, featureReport] =
    await Promise.all([
      // Lượt mở ứng dụng.
      runReport({
        dateRanges: [range],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: { matchType: 'CONTAINS', value: 'open' },
          },
        },
      }),
      // Người dùng hoạt động.
      runReport({
        dateRanges: [range],
        metrics: [{ name: 'totalUsers' }],
      }),
      // Số phiên sử dụng.
      runReport({
        dateRanges: [range],
        metrics: [{ name: 'sessions' }],
      }),
      // Tổng số sự kiện.
      runReport({
        dateRanges: [range],
        metrics: [{ name: 'eventCount' }],
      }),
      // Người dùng mới.
      runReport({
        dateRanges: [range],
        metrics: [{ name: 'newUsers' }],
      }),
      // Sự kiện theo tên — dùng cho "sự kiện sử dụng tính năng".
      runReport({
        dateRanges: [range],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
        limit: 20,
      }),
    ]);

  if (!activeReport) {
    return {
      configured: true,
      message:
        'Không đọc được dữ liệu từ Firebase Analytics Data API. Kiểm tra service account có quyền truy cập property hay không.',
    };
  }

  const totalActiveUsers = metric(activeReport.totals?.[0], 0);
  const totalSessions = metric(sessionReport?.totals?.[0], 0);

  return {
    configured: true,
    data: {
      propertyId,
      rangeStartDate: range.startDate,
      rangeEndDate: range.endDate,
      appOpens: metric(appOpenReport?.totals?.[0], 0),
      activeUsers: totalActiveUsers,
      sessions: totalSessions,
      totalEvents: metric(eventReport?.totals?.[0], 0),
      newUsers: metric(newUserReport?.totals?.[0], 0),
      sessionsPerUser:
        totalActiveUsers > 0
          ? Math.round((totalSessions / totalActiveUsers) * 100) / 100
          : 0,
      featureEvents: (featureReport?.rows ?? []).map((row) => ({
        name: dimension(row, 0),
        count: metric(row, 0),
        users: metric(row, 1),
      })),
    },
  };
}

/**
 * Chuỗi thời gian từ Firebase Analytics (theo ngày) — dùng cho biểu đồ.
 */
export async function getFirebaseAnalyticsTimeSeries(
  days = 30,
): Promise<FirebaseAnalyticsResult<
  { date: string; users: number; sessions: number; events: number }[]
>> {
  const propertyId = normalizePropertyId(config.analytics.propertyId);
  if (!propertyId || !config.analytics.credentials) {
    return { configured: false, message: 'Firebase Analytics chưa được cấu hình.' };
  }

  const safeDays = Math.min(Math.max(days, 1), 90);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - safeDays);

  const report = await runReport({
    dateRanges: [
      {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
      },
    ],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'eventCount' },
    ],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });

  if (!report) {
    return {
      configured: true,
      message: 'Không đọc được chuỗi thời gian từ Firebase Analytics.',
    };
  }

  return {
    configured: true,
    data: (report.rows ?? []).map((row) => ({
      date: dimension(row, 0),
      users: metric(row, 0),
      sessions: metric(row, 1),
      events: metric(row, 2),
    })),
  };
}

/**
 * Trạng thái cấu hình Crashlytics.
 *
 * Crashlytics **không** có API đọc số liệu công khai — dữ liệu crash được xem
 * trực tiếp trên Firebase Console. API này chỉ cung cấp thông tin cấu hình
 * để Admin Web hiển thị hướng dẫn theo dõi đúng chỗ.
 */
export function getCrashlyticsStatus(): {
  projectId: string;
  consoleUrl: string;
  note: string;
} {
  return {
    projectId: config.crashlytics.projectId,
    consoleUrl: `https://console.firebase.google.com/project/${config.crashlytics.projectId}/crashlytics`,
    note:
      'Crashlytics không cung cấp API đọc số liệu công khai. Mở Firebase Console > Crashlytics để theo dõi lỗi và sự cố.',
  };
}
