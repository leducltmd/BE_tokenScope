import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';

const app = createApp();

const DEMO_EMAIL = 'demo@tokenscope.io';
const DEMO_PASSWORD = '123456';

let adminToken = '';

describe('Module Admin — API TokenScope', () => {
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

  describe('Phân quyền', () => {
    it('từ chối khi thiếu token', async () => {
      const res = await request(app).get('/api/admin/overview');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('MISSING_TOKEN');
    });

    it('từ chối khi token không hợp lệ', async () => {
      const res = await request(app)
        .get('/api/admin/overview')
        .set('Authorization', 'Bearer token-khong-hop-le');

      expect(res.status).toBe(401);
    });

    it('từ chối người dùng không có quyền admin', async () => {
      const email = `nonadmin.${Date.now()}@tokenscope.io`;
      const register = await request(app).post('/api/auth/register').send({
        name: 'Non Admin Test',
        birthDate: '1995-01-01',
        email,
        password: 'Test123456',
      });

      const res = await request(app)
        .get('/api/admin/overview')
        .set('Authorization', `Bearer ${register.body.accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('từ chối người dùng thường ở module crash-testing', async () => {
      const email = `nonadmin.crash.${Date.now()}@tokenscope.io`;
      const register = await request(app).post('/api/auth/register').send({
        name: 'Non Admin Crash Test',
        birthDate: '1995-01-01',
        email,
        password: 'Test123456',
      });

      const res = await request(app)
        .get('/api/crash-testing/status')
        .set('Authorization', `Bearer ${register.body.accessToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/overview', () => {
    it('trả về số liệu tổng quan', async () => {
      const res = await request(app)
        .get('/api/admin/overview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.totalUsers).toBe('number');
      expect(typeof res.body.activeUsers).toBe('number');
      expect(typeof res.body.totalAppOpens).toBe('number');
      expect(typeof res.body.totalAiApiCalls).toBe('number');
      expect(res.body.activeUsers).toBeLessThanOrEqual(res.body.totalUsers);
    });
  });

  describe('GET /api/admin/stats', () => {
    it('trả về chuỗi thời gian theo tuần', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .query({ range: 'week' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.range).toBe('week');
      expect(Array.isArray(res.body.series)).toBe(true);
      expect(res.body.series.length).toBe(7);
      expect(Array.isArray(res.body.features)).toBe(true);
    });

    it('trả về chuỗi thời gian theo tháng', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .query({ range: 'month' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.series.length).toBe(30);
    });

    it('từ chối khoảng thống kê không hợp lệ', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .query({ range: 'nam' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/admin/users', () => {
    it('trả về danh sách người dùng kèm số liệu sử dụng', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .query({ offset: 0, limit: 5 })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.limit).toBe(5);

      for (const user of res.body.users) {
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('email');
        expect(user).toHaveProperty('createdAt');
        expect(user).toHaveProperty('usageCount');
        expect(user).toHaveProperty('isCurrentlyActive');
      }
    });

    it('tìm kiếm người dùng theo email', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .query({ search: DEMO_EMAIL })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThan(0);
      expect(res.body.users[0].email).toBe(DEMO_EMAIL);
    });
  });

  describe('GET /api/admin/users/:id', () => {
    it('trả về chi tiết + lịch sử sử dụng', async () => {
      const list = await request(app)
        .get('/api/admin/users')
        .query({ search: DEMO_EMAIL, limit: 1 })
        .set('Authorization', `Bearer ${adminToken}`);

      const userId = list.body.users[0].id;

      const res = await request(app)
        .get(`/api/admin/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(userId);
      expect(Array.isArray(res.body.user.usageHistory)).toBe(true);
      expect(Array.isArray(res.body.user.recentAppEvents)).toBe(true);
      expect(Array.isArray(res.body.daily)).toBe(true);
      expect(res.body.daily.length).toBe(14);
    });

    it('trả về 404 khi không tìm thấy người dùng', async () => {
      const res = await request(app)
        .get('/api/admin/users/khong-ton-tai-123')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/admin/analytics/firebase', () => {
    it('trả về trạng thái cấu hình Analytics và Crashlytics', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/firebase')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.summary).toHaveProperty('configured');
      expect(res.body.crashlytics).toHaveProperty('consoleUrl');
      expect(res.body.crashlytics.consoleUrl).toContain('crashlytics');
    });
  });

  describe('POST /api/app-usage/claim', () => {
    it('gắn userId cho sự kiện app_open ghi trước khi đăng nhập', async () => {
      const sessionId = `sess-test-claim-${Date.now()}`;

      // 1. Ghi sự kiện app_open khi chưa đăng nhập (userId = null).
      const create = await request(app).post('/api/app-usage/events').send({
        eventName: 'app_open',
        sessionId,
        platform: 'vitest',
      });
      expect(create.status).toBe(201);

      const orphan = await prisma.appUsageEvent.findFirst({
        where: { sessionId },
      });
      expect(orphan?.userId).toBeNull();

      // 2. Người dùng đăng nhập → gọi claim để gắn userId vào bản ghi cũ.
      const claim = await request(app)
        .post('/api/app-usage/claim')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sessionId, eventName: 'app_open' });

      expect(claim.status).toBe(200);
      expect(claim.body.claimed).toBe(1);

      const claimed = await prisma.appUsageEvent.findFirst({
        where: { sessionId },
      });
      expect(claimed?.userId).not.toBeNull();

      // 3. Không tạo bản ghi trùng — số bản ghi trong phiên vẫn là 1.
      const count = await prisma.appUsageEvent.count({ where: { sessionId } });
      expect(count).toBe(1);
    });

    it('từ chối khi thiếu token', async () => {
      const res = await request(app).post('/api/app-usage/claim').send({
        eventName: 'app_open',
      });

      expect(res.status).toBe(401);
    });
  });
});
