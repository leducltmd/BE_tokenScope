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

export { z };
