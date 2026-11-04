import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';

const app = createApp();

const DEMO_EMAIL = 'demo@tokenscope.io';
const DEMO_PASSWORD = '123456';

describe('Module Auth — API TokenScope', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('GET /api/health', () => {
    it('trả về trạng thái ok', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('TokenScope API');
    });
  });

  describe('POST /api/auth/login', () => {
    it('đăng nhập thành công với tài khoản demo', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Đăng nhập thành công.');
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.expiresIn).toBe(900);
      expect(res.body.user.email).toBe(DEMO_EMAIL);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('báo lỗi khi sai mật khẩu', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: DEMO_EMAIL, password: 'mat-khau-sai' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.message).toBe('Email hoặc mật khẩu không đúng.');
    });

    it('báo lỗi khi email không tồn tại', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'khong.ton.tai@tokenscope.io', password: DEMO_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('validate email không hợp lệ', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'khong-hop-le', password: DEMO_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });
  });

  describe('POST /api/auth/register', () => {
    it('đăng ký tài khoản mới thành công', async () => {
      const email = `test.${Date.now()}@tokenscope.io`;

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Nguyễn Văn Test',
          birthDate: '1995-05-20',
          email,
          password: 'Abc12345',
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Đăng ký thành công.');
      expect(res.body.user.email).toBe(email);
      expect(res.body.user.name).toBe('Nguyễn Văn Test');
      expect(res.body.accessToken).toBeTruthy();
    });

    it('báo lỗi khi email đã tồn tại', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          birthDate: '1995-05-20',
          email: DEMO_EMAIL,
          password: 'Abc12345',
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('từ chối mật khẩu yếu', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          birthDate: '1995-05-20',
          email: `weak.${Date.now()}@tokenscope.io`,
          password: 'abc',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('luôn trả về thành công kể cả với email chưa đăng ký', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'chua.dang.ky@tokenscope.io' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('liên kết đặt lại mật khẩu');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('làm mới access token bằng refresh token', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: login.body.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.expiresIn).toBe(900);
    });

    it('từ chối refresh token không hợp lệ', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'token-khong-hop-le' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('trả về thông tin người dùng khi có token hợp lệ', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(DEMO_EMAIL);
    });

    it('từ chối khi thiếu token', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('MISSING_TOKEN');
    });

    it('từ chối khi token không hợp lệ', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer token-khong-hop-le');

      expect(res.status).toBe(401);
    });
  });

  describe('Route không tồn tại', () => {
    it('trả về 404 với mã ENDPOINT_NOT_FOUND', async () => {
      const res = await request(app).get('/api/khong-ton-tai');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ENDPOINT_NOT_FOUND');
    });
  });
});
