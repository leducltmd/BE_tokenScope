import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { config } from '../config';
import { AppError } from '../utils/errors';

/** Chuyển mọi lỗi thành response JSON thống nhất. */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      message: error.message,
      code: error.code,
      details: error.details,
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({
        message: 'Dữ liệu đã tồn tại.',
        code: 'UNIQUE_CONSTRAINT',
      });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({
        message: 'Không tìm thấy dữ liệu.',
        code: 'NOT_FOUND',
      });
      return;
    }
  }

  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      message: 'Body của request không phải JSON hợp lệ.',
      code: 'INVALID_JSON',
    });
    return;
  }

  if (config.env !== 'production') {
    console.error('[TokenScope] Lỗi chưa xử lý:', error);
  }

  res.status(500).json({
    message: 'Đã xảy ra lỗi. Vui lòng thử lại sau.',
    code: 'INTERNAL_ERROR',
  });
}

/** Xử lý các route không tồn tại. */
export function notFoundHandler(
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  res.status(404).json({
    message: 'Không tìm thấy endpoint.',
    code: 'ENDPOINT_NOT_FOUND',
  });
}
