import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';

const app = createApp();

const DEMO_EMAIL = 'demo@tokenscope.io';
const DEMO_PASSWORD = '123456';

let adminToken = '';

describe('Module Crash Testing — API TokenScope', () => {
  beforeAll(async () => {
    await prisma.$connect();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });

    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('GET /api/crash-testing/status', () => {
    it('trả về trạng thái tính năng cho admin', async () => {
      const res = await request(app)
        .get('/api/crash-testing/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.enabled).toBe('boolean');
      expect(res.body).toHaveProperty('environment');
      expect(res.body.crashlyticsConsoleUrl).toContain('console.firebase.google.com');
    });
  });

  describe('Vòng đời yêu cầu crash', () => {
    it('tạo → polling → báo cáo hoàn chỉnh', async () => {
      // 1. App đăng ký thiết bị.
      const deviceId = `test-device-${Date.now()}`;
      const register = await request(app).post('/api/crash-testing/devices').send({
        deviceId,
        deviceName: 'Test Emulator',
        platform: 'android',
        appVersion: '1.0.0+1',
      });

      expect(register.status).toBe(200);
      expect(register.body.device.deviceId).toBe(deviceId);
      expect(register.body.device.isOnline).toBe(true);

      // 2. Admin tạo yêu cầu crash.
      const create = await request(app)
        .post('/api/crash-testing/requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ deviceId, reason: 'Test tự động' });

      expect(create.status).toBe(201);
      expect(create.body.request.status).toBe('pending');

      const requestId = create.body.request.id;

      // 3. App polling — nhận yêu cầu và chuyển sang 'triggered'.
      const poll = await request(app)
        .get('/api/crash-testing/poll')
        .query({ deviceId });

      expect(poll.status).toBe(200);
      expect(poll.body.requests.length).toBeGreaterThan(0);
      expect(poll.body.requests[0].id).toBe(requestId);
      expect(poll.body.requests[0].status).toBe('triggered');

      // 4. App báo cáo 'reported' — Crashlytics đã ghi nhận log.
      const report = await request(app)
        .post(`/api/crash-testing/requests/${requestId}/report`)
        .send({ status: 'reported', result: 'Da ghi nhan log Crashlytics.' });

      expect(report.status).toBe(200);
      expect(report.body.request.status).toBe('reported');
      expect(report.body.request.reportedAt).not.toBeNull();
    });

    it('không trả lại yêu cầu đã được nhận (tránh xử lý trùng)', async () => {
      const deviceId = `test-device-dup-${Date.now()}`;
      await request(app).post('/api/crash-testing/devices').send({ deviceId });

      await request(app)
        .post('/api/crash-testing/requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ deviceId });

      const first = await request(app)
        .get('/api/crash-testing/poll')
        .query({ deviceId });
      expect(first.body.requests.length).toBe(1);

      const second = await request(app)
        .get('/api/crash-testing/poll')
        .query({ deviceId });
      expect(second.body.requests.length).toBe(0);
    });

    it('trả về 404 khi báo cáo yêu cầu không tồn tại', async () => {
      const res = await request(app)
        .post('/api/crash-testing/requests/khong-ton-tai/report')
        .send({ status: 'reported' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/crash-testing/devices', () => {
    it('trả về danh sách thiết bị đã đăng ký', async () => {
      const res = await request(app)
        .get('/api/crash-testing/devices')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.devices)).toBe(true);
    });
  });

  describe('GET /api/crash-testing/requests', () => {
    it('trả về lịch sử yêu cầu', async () => {
      const res = await request(app)
        .get('/api/crash-testing/requests')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.requests)).toBe(true);
    });
  });
});
