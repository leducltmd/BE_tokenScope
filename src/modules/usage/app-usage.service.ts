import { prisma } from '../../config/prisma';
import { BadRequestError } from '../../utils/errors';

/** Tên sự kiện app usage được phép ghi nhận. */
const ALLOWED_EVENTS = new Set([
  'app_open',
  'app_close',
  'app_pause',
  'app_resume',
  'feature_usage',
  'screen_view',
  'session_start',
  'session_end',
]);

/** Sự kiện được ghi nhận từ Flutter App. */
export interface AppUsageEventInput {
  eventName: string;
  feature?: string | null;
  screen?: string | null;
  sessionId?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string | null;
}

/**
 * Ghi nhận một sự kiện sử dụng ứng dụng.
 *
 * `userId` được lấy từ access token nếu có; nếu app chưa đăng nhập thì sự
 * kiện vẫn được ghi nhận (userId = null) để vẫn đếm được "lượt mở ứng dụng".
 */
export async function recordAppUsageEvent(
  input: AppUsageEventInput,
  userId?: string | null,
): Promise<{ id: string; occurredAt: string }> {
  if (!ALLOWED_EVENTS.has(input.eventName)) {
    throw new BadRequestError(
      `Sự kiện không hợp lệ: ${input.eventName}.`,
    );
  }

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    throw new BadRequestError('Thời điểm sự kiện không hợp lệ.');
  }

  const event = await prisma.appUsageEvent.create({
    data: {
      userId: userId ?? null,
      sessionId: input.sessionId ?? null,
      eventName: input.eventName,
      feature: input.feature ?? null,
      screen: input.screen ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      platform: input.platform ?? null,
      appVersion: input.appVersion ?? null,
      occurredAt,
    },
    select: { id: true, occurredAt: true },
  });

  return {
    id: event.id,
    occurredAt: event.occurredAt.toISOString(),
  };
}

/**
 * Gắn userId cho sự kiện "mồ côi" đã ghi trước khi người dùng đăng nhập.
 *
 * Sự kiện `app_open` được ghi khi app khởi động — lúc đó người dùng chưa
 * đăng nhập nên `userId` là null. Sau khi đăng nhập, app gọi hàm này để gắn
 * userId vào chính bản ghi cũ (không tạo bản ghi mới), tránh tính trùng
 * "lượt mở ứng dụng".
 *
 * @returns số lượng bản ghi đã được gắn userId.
 */
export async function claimOrphanEvent(
  userId: string | null,
  sessionId?: string | null,
  eventName?: string | null,
): Promise<number> {
  if (!userId) return 0;

  const where: Record<string, unknown> = { userId: null };
  if (sessionId) where.sessionId = sessionId;
  if (eventName) where.eventName = eventName;

  // Chỉ nhận sự kiện gần đây (trong 1 giờ) để tránh gắn nhầm phiên cũ.
  const recent = new Date();
  recent.setHours(recent.getHours() - 1);
  where.occurredAt = { gte: recent };

  const result = await prisma.appUsageEvent.updateMany({
    where,
    data: { userId },
  });

  return result.count;
}
