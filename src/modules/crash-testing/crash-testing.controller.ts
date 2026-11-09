import type { NextFunction, Request, Response } from 'express';

import { config, isCrashTestingAllowed } from '../../config';
import { ForbiddenError } from '../../utils/errors';
import * as crashService from './crash-testing.service';
import type {
  CreateCrashRequestDto,
  HeartbeatDto,
  RegisterDeviceDto,
  ReportCrashRequestDto,
} from './crash-testing.validation';

/**
 * Kiểm tra tính năng crash testing có được bật trong môi trường hiện tại hay
 * không. Ở production luôn bị chặn.
 */
function assertCrashTestingEnabled(): void {
  if (!isCrashTestingAllowed(config.env)) {
    throw new ForbiddenError(
      'Tính năng Crash Testing đang tắt. Chỉ bật ở môi trường demo/testing (không dùng trên production).',
    );
  }
}

/** GET /api/crash-testing/status — Trạng thái tính năng crash testing. */
export async function status(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const enabled = isCrashTestingAllowed(config.env);
    res.status(200).json({
      enabled,
      environment: config.env,
      allowedEnvironments: config.crashTesting.allowedEnvironments,
      projectId: config.crashlytics.projectId,
      crashlyticsConsoleUrl: `https://console.firebase.google.com/project/${config.crashlytics.projectId}/crashlytics`,
      message: enabled
        ? 'Crash Testing đang được bật cho môi trường này.'
        : 'Crash Testing đang tắt. Bật bằng biến môi trường CRASH_TESTING_ENABLED=true (không dùng trên production).',
    });
  } catch (error) {
    next(error);
  }
}

/** GET /api/crash-testing/devices — Danh sách thiết bị Flutter đã đăng ký. */
export async function devices(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertCrashTestingEnabled();
    const list = await crashService.listDevices();
    res.status(200).json({ devices: list });
  } catch (error) {
    next(error);
  }
}

/** POST /api/crash-testing/devices — App đăng ký thiết bị (heartbeat). */
export async function registerDevice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertCrashTestingEnabled();
    const dto = req.body as RegisterDeviceDto;

    // Nếu request có access token, gắn userId từ token cho chính xác.
    let userId = dto.userId ?? null;
    if (req.user) userId = req.user.id;

    const device = await crashService.registerDevice({
      deviceId: dto.deviceId,
      userId,
      deviceName: dto.deviceName ?? null,
      platform: dto.platform ?? null,
      appVersion: dto.appVersion ?? null,
    });
    res.status(200).json({ device });
  } catch (error) {
    next(error);
  }
}

/** POST /api/crash-testing/devices/heartbeat — App báo vẫn còn hoạt động. */
export async function heartbeat(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertCrashTestingEnabled();
    const dto = req.body as HeartbeatDto;
    const device = await crashService.heartbeat(dto.deviceId, dto.isOnline);
    if (!device) {
      res.status(404).json({
        message: 'Thiết bị chưa được đăng ký.',
        code: 'DEVICE_NOT_FOUND',
      });
      return;
    }
    res.status(200).json({ device });
  } catch (error) {
    next(error);
  }
}

/** GET /api/crash-testing/requests — App polling lấy yêu cầu crash. */
export async function poll(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertCrashTestingEnabled();
    const deviceId = String(req.query.deviceId ?? '').trim();
    if (!deviceId) {
      res.status(400).json({
        message: 'Thiếu deviceId.',
        code: 'MISSING_DEVICE_ID',
      });
      return;
    }
    const requests = await crashService.pollRequests(deviceId);
    res.status(200).json({ requests });
  } catch (error) {
    next(error);
  }
}

/** POST /api/crash-testing/requests/:id/report — App báo cáo kết quả crash. */
export async function report(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertCrashTestingEnabled();
    const dto = req.body as ReportCrashRequestDto;
    const request = await crashService.reportRequest(req.params.id, {
      status: dto.status,
      result: dto.result ?? null,
    });
    res.status(200).json({ request });
  } catch (error) {
    next(error);
  }
}
