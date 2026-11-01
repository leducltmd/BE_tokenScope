import type { NextFunction, Request, Response } from 'express';

import { UnauthorizedError } from '../utils/errors';
import { verifyAccessToken } from '../utils/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
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
