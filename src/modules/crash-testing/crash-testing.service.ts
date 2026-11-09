import { prisma } from '../../config/prisma';
import { NotFoundError } from '../../utils/errors';

/** Trạng thái của một yêu cầu crash test. */
export type CrashRequestStatus =
  | 'pending'
  | 'triggered'
  | 'reported'
  | 'failed';

export interface CrashTestDeviceView {
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  appVersion: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  isOnline: boolean;
  lastSeenAt: string;
  createdAt: string;
}

export interface CrashTestRequestView {
  id: string;
  deviceId: string | null;
  deviceName: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  status: CrashRequestStatus;
  reason: string | null;
  result: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  triggeredAt: string | null;
  reportedAt: string | null;
}

/** Thời gian tối đa một thiết bị được coi là "online" (giây). */
const ONLINE_TTL_SECONDS = 60;

/**
 * Đăng ký / cập nhật thiết bị Flutter đang chạy.
 *
 * App gọi endpoint này mỗi lần khởi động (và định kỳ) để backend biết
 * thiết bị nào có thể nhận yêu cầu crash test.
 */
export async function registerDevice(input: {
  deviceId: string;
  userId?: string | null;
  deviceName?: string | null;
  platform?: string | null;
  appVersion?: string | null;
}): Promise<CrashTestDeviceView> {
  const device = await prisma.crashTestDevice.upsert({
    where: { deviceId: input.deviceId },
    create: {
      deviceId: input.deviceId,
      userId: input.userId ?? null,
      deviceName: input.deviceName ?? null,
      platform: input.platform ?? null,
      appVersion: input.appVersion ?? null,
      isOnline: true,
      lastSeenAt: new Date(),
    },
    update: {
      userId: input.userId ?? undefined,
      deviceName: input.deviceName ?? undefined,
      platform: input.platform ?? undefined,
      appVersion: input.appVersion ?? undefined,
      isOnline: true,
      lastSeenAt: new Date(),
    },
  });

  return toDeviceView(device, await resolveUserName(device.userId));
}

/** Cập nhật trạng thái online/offline của thiết bị. */
export async function heartbeat(
  deviceId: string,
  isOnline = true,
): Promise<CrashTestDeviceView | null> {
  const device = await prisma.crashTestDevice.findUnique({
    where: { deviceId },
  });
  if (!device) return null;

  const updated = await prisma.crashTestDevice.update({
    where: { deviceId },
    data: { isOnline, lastSeenAt: new Date() },
  });

  return toDeviceView(updated, await resolveUserName(updated.userId));
}

/** Danh sách thiết bị đã đăng ký (mới nhất trước). */
export async function listDevices(): Promise<CrashTestDeviceView[]> {
  const devices = await prisma.crashTestDevice.findMany({
    orderBy: { lastSeenAt: 'desc' },
    take: 100,
  });

  const userIds = devices
    .map((d) => d.userId)
    .filter((v): v is string => Boolean(v));

  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  return devices.map((device) => {
    const user = device.userId ? userMap.get(device.userId) : undefined;
    return toDeviceView(device, user ?? null);
  });
}

/** Tạo yêu cầu crash test mới (do Admin phát ra). */
export async function createRequest(input: {
  deviceId?: string | null;
  requestedBy: string;
  requestedByName?: string | null;
  reason?: string | null;
}): Promise<CrashTestRequestView> {
  if (input.deviceId) {
    const device = await prisma.crashTestDevice.findUnique({
      where: { deviceId: input.deviceId },
    });
    if (!device) {
      throw new NotFoundError(
        'Không tìm thấy thiết bị đã chọn. Hãy đăng ký thiết bị từ ứng dụng trước.',
      );
    }
  }

  const request = await prisma.crashTestRequest.create({
    data: {
      deviceId: input.deviceId ?? null,
      requestedBy: input.requestedBy,
      requestedByName: input.requestedByName ?? null,
      reason: input.reason ?? null,
      status: 'pending',
    },
  });

  return toRequestView(request, null);
}

/**
 * App polling — lấy yêu cầu crash test đang chờ cho thiết bị này.
 *
 * Yêu cầu ở trạng thái `pending` sẽ được chuyển sang `triggered` ngay khi
 * app lấy được — tránh việc app nhận trùng một yêu cầu.
 */
export async function pollRequests(
  deviceId: string,
): Promise<CrashTestRequestView[]> {
  const requests = await prisma.crashTestRequest.findMany({
    where: {
      status: 'pending',
      OR: [{ deviceId }, { deviceId: null }],
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });

  if (requests.length === 0) return [];

  const now = new Date();
  const claimed: CrashTestRequestView[] = [];

  for (const request of requests) {
    const updated = await prisma.crashTestRequest.updateMany({
      where: { id: request.id, status: 'pending' },
      data: {
        status: 'triggered',
        triggeredAt: now,
        attemptCount: { increment: 1 },
      },
    });

    // Chỉ thiết bị thực sự "nhận được" yêu cầu mới được báo `triggered`.
    if (updated.count > 0) {
      claimed.push(toRequestView({ ...request, status: 'triggered' }, null));
    }
  }

  return claimed;
}

/**
 * App báo cáo kết quả sau khi kích hoạt crash.
 *
 * `status`:
 * - `triggered` — app đã nhận lệnh và sắp crash (dùng khi app chưa kịp gửi).
 * - `reported` — app đã ghi nhận log Crashlytics thành công.
 * - `failed` — app không thể kích hoạt crash (ví dụ chạy trên Web).
 */
export async function reportRequest(
  requestId: string,
  input: {
    status: 'triggered' | 'reported' | 'failed';
    result?: string | null;
  },
): Promise<CrashTestRequestView> {
  const request = await prisma.crashTestRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) {
    throw new NotFoundError('Không tìm thấy yêu cầu crash test.');
  }

  const now = new Date();
  const updated = await prisma.crashTestRequest.update({
    where: { id: requestId },
    data: {
      status: input.status,
      result: input.result ?? request.result,
      reportedAt: input.status === 'reported' || input.status === 'failed' ? now : undefined,
      triggeredAt: request.triggeredAt ?? (input.status === 'triggered' ? now : undefined),
    },
  });

  return toRequestView(updated, null);
}

/** Danh sách yêu cầu crash test gần đây. */
export async function listRequests(limit = 50): Promise<CrashTestRequestView[]> {
  const requests = await prisma.crashTestRequest.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  });

  const deviceIds = requests
    .map((r) => r.deviceId)
    .filter((v): v is string => Boolean(v));

  const devices = deviceIds.length
    ? await prisma.crashTestDevice.findMany({
        where: { deviceId: { in: deviceIds } },
        select: { deviceId: true, deviceName: true },
      })
    : [];
  const deviceMap = new Map(devices.map((d) => [d.deviceId, d]));

  return requests.map((request) =>
    toRequestView(
      request,
      request.deviceId ? deviceMap.get(request.deviceId) : undefined,
    ),
  );
}

/** Đánh dấu thiết bị đã "online" nếu heartbeat còn trong TTL. */
export function isDeviceOnline(lastSeenAt: Date): boolean {
  const diffSeconds = (Date.now() - lastSeenAt.getTime()) / 1000;
  return diffSeconds <= ONLINE_TTL_SECONDS;
}

/** Lấy tên người dùng từ userId (phụ trợ cho hiển thị). */
async function resolveUserName(
  userId: string | null,
): Promise<{ name: string; email: string } | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  return user ? { name: user.name, email: user.email } : null;
}

function toDeviceView(
  device: {
    deviceId: string;
    deviceName: string | null;
    platform: string | null;
    appVersion: string | null;
    userId: string | null;
    isOnline: boolean;
    lastSeenAt: Date;
    createdAt: Date;
  },
  user: { name: string; email: string } | null,
): CrashTestDeviceView {
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    platform: device.platform,
    appVersion: device.appVersion,
    userId: device.userId,
    userName: user?.name ?? null,
    userEmail: user?.email ?? null,
    isOnline: device.isOnline && isDeviceOnline(device.lastSeenAt),
    lastSeenAt: device.lastSeenAt.toISOString(),
    createdAt: device.createdAt.toISOString(),
  };
}

function toRequestView(
  request: {
    id: string;
    deviceId: string | null;
    requestedBy: string | null;
    requestedByName: string | null;
    status: string;
    reason: string | null;
    result: string | null;
    attemptCount: number;
    createdAt: Date;
    updatedAt: Date;
    triggeredAt: Date | null;
    reportedAt: Date | null;
  },
  device: { deviceName: string | null } | null | undefined,
): CrashTestRequestView {
  return {
    id: request.id,
    deviceId: request.deviceId,
    deviceName: device?.deviceName ?? null,
    requestedBy: request.requestedBy,
    requestedByName: request.requestedByName,
    status: request.status as CrashRequestStatus,
    reason: request.reason,
    result: request.result,
    attemptCount: request.attemptCount,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    triggeredAt: request.triggeredAt?.toISOString() ?? null,
    reportedAt: request.reportedAt?.toISOString() ?? null,
  };
}
