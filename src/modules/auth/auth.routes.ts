import { Router } from 'express';

import { requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import {
  changePassword,
  forgotPassword,
  googleLogin,
  login,
  logout,
  me,
  refresh,
  register,
} from './auth.controller';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleLoginSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
} from './auth.validation';

export const authRouter = Router();

authRouter.post('/register', validate(registerSchema), register);
authRouter.post('/login', validate(loginSchema), login);
authRouter.post('/google', validate(googleLoginSchema), googleLogin);
authRouter.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
authRouter.post('/refresh', validate(refreshSchema), refresh);
authRouter.post('/logout', logout);

authRouter.get('/me', requireAuth, me);
authRouter.post('/change-password', requireAuth, validate(changePasswordSchema), changePassword);
