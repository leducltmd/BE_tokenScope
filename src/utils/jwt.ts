import jwt, { type SignOptions } from 'jsonwebtoken';

import { config } from '../config';
import { UnauthorizedError } from './errors';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
  type: 'refresh';
}

export function signAccessToken(payload: {
  userId: string;
  email: string;
}): string {
  const options: SignOptions = {
    expiresIn: config.jwt.accessExpiresIn as SignOptions['expiresIn'],
  };
  return jwt.sign(
    { email: payload.email, type: 'access' },
    config.jwt.accessSecret,
    { ...options, subject: payload.userId },
  );
}

export function signRefreshToken(payload: {
  userId: string;
  sessionId: string;
}): string {
  const options: SignOptions = {
    expiresIn: config.jwt.refreshExpiresIn as SignOptions['expiresIn'],
  };
  return jwt.sign(
    { sessionId: payload.sessionId, type: 'refresh' },
    config.jwt.refreshSecret,
    { ...options, subject: payload.userId },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret) as AccessTokenPayload;
    if (decoded.type !== 'access') {
      throw new UnauthorizedError('Token không hợp lệ.', 'INVALID_TOKEN');
    }
    return decoded;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError(
      'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
      'TOKEN_EXPIRED',
    );
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwt.refreshSecret) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') {
      throw new UnauthorizedError('Token không hợp lệ.', 'INVALID_TOKEN');
    }
    return decoded;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError(
      'Phiên làm mới đã hết hạn. Vui lòng đăng nhập lại.',
      'REFRESH_TOKEN_EXPIRED',
    );
  }
}

/** Lấy thời hạn hết hạn (giây) của một token đã ký. */
export function getTokenExpirySeconds(token: string): number {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded?.exp) return 0;
  return decoded.exp - Math.floor(Date.now() / 1000);
}
