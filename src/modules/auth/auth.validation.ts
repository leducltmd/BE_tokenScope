import { z } from 'zod';

/** Quy tắc validate dùng chung cho module auth. */

export const passwordSchema = z
  .string()
  .min(6, 'Mật khẩu phải có ít nhất 6 ký tự.')
  .max(72, 'Mật khẩu không được vượt quá 72 ký tự.')
  .regex(/[A-Za-z]/, 'Mật khẩu phải có ít nhất một chữ cái.')
  .regex(/[0-9]/, 'Mật khẩu phải có ít nhất một chữ số.');

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email là bắt buộc.')
  .email('Email không hợp lệ.')
  .max(255, 'Email quá dài.');

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Họ và tên phải có ít nhất 2 ký tự.')
    .max(120, 'Họ và tên quá dài.'),
  birthDate: z
    .string()
    .trim()
    .min(1, 'Ngày sinh là bắt buộc.')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày sinh phải có định dạng YYYY-MM-DD.')
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return false;
      return date.getUTCFullYear() === Number(value.slice(0, 4));
    }, 'Ngày sinh không hợp lệ.')
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      const now = new Date();
      return date.getTime() < now.getTime();
    }, 'Ngày sinh phải nằm trong quá khứ.')
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      const now = new Date();
      const age =
        (now.getTime() - date.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
      return age >= 13;
    }, 'Bạn phải đủ 13 tuổi để đăng ký.'),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Mật khẩu là bắt buộc.'),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token là bắt buộc.'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mật khẩu hiện tại là bắt buộc.'),
  newPassword: passwordSchema,
});

export const googleLoginSchema = z.object({
  idToken: z.string().trim().min(10, 'ID Token là bắt buộc.'),
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
export type GoogleLoginDto = z.infer<typeof googleLoginSchema>;
