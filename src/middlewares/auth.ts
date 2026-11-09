import type { NextFunction, Request, Response } from 'express';

import { prisma } from '../config/prisma';
import { isAdminEmail } from '../config';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import { verifyAccessToken } from '../utils/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
      /** Thông tin quyền admin — chỉ được gán khi đã qua `requireAdmin`. */
      admin?: {
        id: string;
        email: string;
        name: string;
        role: string;
      };
    }
  }
}

/** Bắt buộc có access token hợp lệ trong header Authorization. */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.get('authorization');

  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    next(
      new UnauthorizedError(
        'Thiếu token xác thực. Vui lòng đăng nhập.',
        'MISSING_TOKEN',
      ),
    );
    return;
  }

  const token = header.slice(7).trim();
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Bắt buộc tài khoản đang đăng nhập có quyền Admin.
 *
 * Quyền Admin được xác định theo 2 nguồn (theo thứ tự ưu tiên):
 * 1. `User.role = 'admin'` trong database — nguồn chuẩn.
 * 2. Email nằm trong danh sách `ADMIN_EMAILS` — fallback cho môi trường
 *    demo/lab khi chưa cập nhật role trong DB.
 *
 * Middleware này phải đặt SAU `requireAuth` vì cần đọc `req.user`.
 */
export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new UnauthorizedError(
        'Thiếu token xác thực. Vui lòng đăng nhập.',
        'MISSING_TOKEN',
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedError('Người dùng không tồn tại.', 'USER_NOT_FOUND');
    }

    const isAdmin = user.role === 'admin' || isAdminEmail(user.email);
    if (!isAdmin) {
      throw new ForbiddenError(
        'Chỉ quản trị viên mới được phép truy cập khu vực này.',
      );
    }

    req.admin = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    next();
  } catch (error) {
    next(error);
  }
}
