import type { NextFunction, Request, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';

import { BadRequestError } from '../utils/errors';

/**
 * Middleware validate body theo schema Zod.
 * Thông báo lỗi đầu tiên được dùng làm `message` trả về cho client.
 */
export function validate(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      }));
      next(
        new BadRequestError(issues[0]?.message ?? 'Dữ liệu không hợp lệ.', issues),
      );
      return;
    }

    req.body = result.data;
    next();
  };
}

/**
 * Middleware validate query string theo schema Zod.
 *
 * Kết quả đã parse được gán lại vào `req.query` (giá trị luôn là string nên
 * ép kiểu number trong schema sẽ không hoạt động — dùng `z.coerce`).
 */
export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'query',
        message: issue.message,
      }));
      next(
        new BadRequestError(
          issues[0]?.message ?? 'Truy vấn không hợp lệ.',
          issues,
        ),
      );
      return;
    }

    // Gán lại giá trị đã chuẩn hoá (mặc định, ép kiểu) vào `res.locals` vì
    // `req.query` ở Express 4 là property chỉ đọc.
    res.locals.query = result.data;
    next();
  };
}

export { z };
