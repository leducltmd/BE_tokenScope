import type { NextFunction, Request, Response } from 'express';

import * as authService from './auth.service';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  GoogleLoginDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
} from './auth.validation';

/** POST /api/auth/register — Đăng ký tài khoản mới. */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = req.body as RegisterDto;
    const session = await authService.register(dto);
    res.status(201).json({
      message: 'Đăng ký thành công.',
      user: session.user,
      accessToken: session.tokens.accessToken,
      refreshToken: session.tokens.refreshToken,
      expiresIn: session.tokens.expiresIn,
      tokenType: session.tokens.tokenType,
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/auth/login — Đăng nhập bằng email và mật khẩu. */
export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = req.body as LoginDto;
    const session = await authService.login({
      email: dto.email,
      password: dto.password,
      userAgent: req.get('user-agent') ?? undefined,
      ipAddress: req.ip,
    });
    res.status(200).json({
      message: 'Đăng nhập thành công.',
      user: session.user,
      accessToken: session.tokens.accessToken,
      refreshToken: session.tokens.refreshToken,
      expiresIn: session.tokens.expiresIn,
      tokenType: session.tokens.tokenType,
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/auth/google — Đăng nhập bằng Google ID Token (Firebase). */
export async function googleLogin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = req.body as GoogleLoginDto;
    const session = await authService.loginWithGoogle({
      idToken: dto.idToken,
      userAgent: req.get('user-agent') ?? undefined,
      ipAddress: req.ip,
    });
    res.status(200).json({
      message: 'Đăng nhập Google thành công.',
      user: session.user,
      accessToken: session.tokens.accessToken,
      refreshToken: session.tokens.refreshToken,
      expiresIn: session.tokens.expiresIn,
      tokenType: session.tokens.tokenType,
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/auth/forgot-password — Gửi link đặt lại mật khẩu. */
export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = req.body as ForgotPasswordDto;
    await authService.forgotPassword(dto);
    // Luôn trả về thành công để không tiết lộ email nào đã đăng ký.
    res.status(200).json({
      message:
        'Nếu email này đã đăng ký, chúng tôi đã gửi liên kết đặt lại mật khẩu.',
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/auth/refresh — Làm mới access token. */
export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = req.body as RefreshDto;
    const tokens = await authService.refreshSession(dto.refreshToken);
    res.status(200).json({
      message: 'Làm mới phiên thành công.',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: tokens.tokenType,
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/auth/logout — Thu hồi phiên hiện tại. */
export async function logout(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const refreshToken = (req.body as { refreshToken?: string }).refreshToken;
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    res.status(200).json({ message: 'Đăng xuất thành công.' });
  } catch (error) {
    next(error);
  }
}

/** GET /api/auth/me — Thông tin người dùng hiện tại. */
export async function me(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await authService.getProfile(req.user!.id);
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

/** POST /api/auth/change-password — Đổi mật khẩu. */
export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = req.body as ChangePasswordDto;
    await authService.changePassword(
      req.user!.id,
      dto.currentPassword,
      dto.newPassword,
    );
    res.status(200).json({
      message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.',
    });
  } catch (error) {
    next(error);
  }
}
