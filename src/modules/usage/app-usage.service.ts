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
