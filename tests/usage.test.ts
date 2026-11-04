import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';

const app = createApp();

const DEMO_EMAIL = 'demo@tokenscope.io';
const DEMO_PASSWORD = '123456';

let accessToken = '';

describe('Module Usage — API TokenScope', () => {
  beforeAll(async () => {
    await prisma.$connect();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });

    accessToken = login.body.accessToken;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Xác thực', () => {
    it('từ chối khi thiếu token', async () => {
      const res = await request(app).get('/api/usage/records');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('MISSING_TOKEN');
    });

    it('từ chối khi token không hợp lệ', async () => {
      const res = await request(app)
        .get('/api/usage/summary')
        .set('Authorization', 'Bearer token-khong-hop-le');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/usage/records', () => {
    it('trả về danh sách bản ghi kèm phân trang', async () => {
      const res = await request(app)
        .get('/api/usage/records')
        .query({ offset: 0, limit: 5 })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.records)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(0);
      expect(res.body.offset).toBe(0);
      expect(res.body.limit).toBe(5);
      expect(res.body.records.length).toBeLessThanOrEqual(5);

      for (const record of res.body.records) {
        expect(record).toHaveProperty('id');
        expect(record).toHaveProperty('provider');
        expect(record).toHaveProperty('model');
        expect(typeof record.totalTokens).toBe('number');
        expect(typeof record.cost).toBe('number');
      }
    });

    it('lọc theo loại nhà cung cấp', async () => {
      const res = await request(app)
        .get('/api/usage/records')
        .query({ providerType: 'openai', limit: 100 })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      for (const record of res.body.records) {
        expect(record.providerType).toBe('openai');
      }
    });

    it('tìm kiếm theo model', async () => {
      const res = await request(app)
        .get('/api/usage/records')
        .query({ search: 'gpt-4o', limit: 100 })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(0);
    });

    it('validate limit vượt quá giới hạn', async () => {
      const res = await request(app)
        .get('/api/usage/records')
        .query({ limit: 500 })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('lọc theo khoảng thời gian', async () => {
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const res = await request(app)
        .get('/api/usage/records')
        .query({ from, limit: 100 })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      for (const record of res.body.records) {
        expect(new Date(record.timestamp).getTime()).toBeGreaterThanOrEqual(
          new Date(from).getTime(),
        );
      }
    });
  });

  describe('GET /api/usage/summary', () => {
    it('tổng hợp token, chi phí và phân bổ theo nhà cung cấp', async () => {
      const res = await request(app)
        .get('/api/usage/summary')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.totalTokens).toBe('number');
      expect(typeof res.body.totalCost).toBe('number');
      expect(typeof res.body.requestCount).toBe('number');
      expect(Array.isArray(res.body.byProvider)).toBe(true);
      expect(Array.isArray(res.body.daily)).toBe(true);

      const providerTokens = res.body.byProvider.reduce(
        (sum: number, p: { totalTokens: number }) => sum + p.totalTokens,
        0,
      );
      expect(providerTokens).toBe(res.body.totalTokens);
    });
  });

  describe('GET /api/usage/records/:id', () => {
    it('trả về chi tiết bản ghi', async () => {
      const list = await request(app)
        .get('/api/usage/records')
        .query({ limit: 1 })
        .set('Authorization', `Bearer ${accessToken}`);

      if (list.body.records.length === 0) return;

      const id = list.body.records[0].id;
      const res = await request(app)
        .get(`/api/usage/records/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.record.id).toBe(id);
    });

    it('trả về 404 khi không tìm thấy bản ghi', async () => {
      const res = await request(app)
        .get('/api/usage/records/khong-ton-tai')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });
});
