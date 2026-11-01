import bcrypt from 'bcryptjs';

import { prisma } from '../../config/prisma';
import { ConflictError, UnauthorizedError } from '../../utils/errors';
import {
  generateOpaqueToken,
  normalizeEmail,
  normalizeName,
} from '../../utils/helpers';
import {
  getTokenExpirySeconds,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt';

const SALT_ROUNDS = 12;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  birthDate: Date | null;
  avatarUrl: string | null;
  isVerified: boolean;
  createdAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthSession {
  user: AuthUser;
  tokens: AuthTokens;
}

export interface RegisterInput {
  name: string;
  birthDate: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface ForgotPasswordInput {
  email: string;
}

/** Chuyển model User của Prisma sang đối tượng trả về cho client. */
function toAuthUser(user: {
  id: string;
  email: string;
  name: string;
  birthDate: Date | null;
  avatarUrl: string | null;
  isVerified: boolean;
  createdAt: Date;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    birthDate: user.birthDate,
    avatarUrl: user.avatarUrl,
    isVerified: user.isVerified,
    createdAt: user.createdAt,
  };
}

/** Tạo access token + refresh token và lưu phiên vào database. */
async function issueTokens(
  userId: string,
  email: string,
  meta?: { userAgent?: string; ipAddress?: string },
): Promise<AuthTokens> {
  const session = await prisma.session.create({
    data: {
      userId,
      refreshToken: generateOpaqueToken(),
      userAgent: meta?.userAgent ?? null,
      ipAddress: meta?.ipAddress ?? null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const accessToken = signAccessToken({ userId, email });
  const refreshToken = signRefreshToken({ userId, sessionId: session.id });

  return {
    accessToken,
    refreshToken,
    expiresIn: getTokenExpirySeconds(accessToken),
    tokenType: 'Bearer',
  };
}

/** Đăng ký tài khoản mới. */
export async function register(input: RegisterInput): Promise<AuthSession> {
  const email = normalizeEmail(input.email);
  const name = normalizeName(input.name);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictError(
      'Email này đã được đăng ký. Vui lòng đăng nhập.',
      'EMAIL_ALREADY_EXISTS',
    );
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email,
      name,
      birthDate: new Date(`${input.birthDate}T00:00:00.000Z`),
      passwordHash,
      isVerified: false,
    },
  });

  const tokens = await issueTokens(user.id, user.email);

  return { user: toAuthUser(user), tokens };
}

/** Đăng nhập bằng email và mật khẩu. */
export async function login(input: LoginInput): Promise<AuthSession> {
  const email = normalizeEmail(input.email);

  const user = await prisma.user.findUnique({ where: { email } });

  // Vẫn băm mật khẩu kể cả khi không có user để tránh lộ thông tin qua thời gian phản hồi.
  const passwordHash =
    user?.passwordHash ??
    '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
  const passwordMatches = await bcrypt.compare(input.password, passwordHash);

  if (!user || !passwordMatches) {
    throw new UnauthorizedError(
      'Email hoặc mật khẩu không đúng.',
      'INVALID_CREDENTIALS',
    );
  }

  if (!user.isActive) {
    throw new UnauthorizedError(
      'Tài khoản đã bị vô hiệu hoá. Vui lòng liên hệ quản trị viên.',
      'ACCOUNT_DISABLED',
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const tokens = await issueTokens(user.id, user.email, {
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });

  return { user: toAuthUser(user), tokens };
}

/**
 * Gửi liên kết đặt lại mật khẩu.
 *
 * Hiện tại backend chưa có dịch vụ email nên chỉ ghi nhận yêu cầu.
 * Luôn trả về thành công để không tiết lộ email nào đã đăng ký.
 */
export async function forgotPassword(input: ForgotPasswordInput): Promise<void> {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;

  // TODO: tích hợp dịch vụ email để gửi link đặt lại mật khẩu.
}

/** Làm mới access token bằng refresh token. */
export async function refreshSession(refreshToken: string): Promise<AuthTokens> {
  const payload = verifyRefreshToken(refreshToken);

  const session = await prisma.session.findUnique({
    where: { id: payload.sessionId },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new UnauthorizedError(
      'Phiên làm mới đã hết hạn. Vui lòng đăng nhập lại.',
      'REFRESH_TOKEN_EXPIRED',
    );
  }

  const user = session.user;
  if (!user.isActive) {
    throw new UnauthorizedError(
      'Tài khoản đã bị vô hiệu hoá.',
      'ACCOUNT_DISABLED',
    );
  }

  const accessToken = signAccessToken({ userId: user.id, email: user.email });
  return {
    accessToken,
    refreshToken: session.refreshToken,
    expiresIn: getTokenExpirySeconds(accessToken),
    tokenType: 'Bearer',
  };
}

/** Thu hồi một phiên đăng nhập. */
export async function logout(refreshToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { refreshToken, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Thu hồi toàn bộ phiên của một người dùng. */
export async function logoutAll(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Lấy thông tin người dùng hiện tại. */
export async function getProfile(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError('Người dùng không tồn tại.', 'USER_NOT_FOUND');
  }
  return toAuthUser(user);
}

/** Đổi mật khẩu và thu hồi các phiên khác. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError('Người dùng không tồn tại.', 'USER_NOT_FOUND');
  }

  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) {
    throw new UnauthorizedError(
      'Mật khẩu hiện tại không đúng.',
      'INVALID_CREDENTIALS',
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await logoutAll(userId);
}
