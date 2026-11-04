import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';

const app = createApp();

const DEMO_EMAIL = 'demo@tokenscope.io';
const DEMO_PASSWORD = '123456';

let accessToken = '';

describe('Module Projects & Budgets — API TokenScope', () => {
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
      const projects = await request(app).get('/api/projects');
      const budgets = await request(app).get('/api/budgets');

      expect(projects.status).toBe(401);
      expect(budgets.status).toBe(401);
    });
  });

  describe('GET /api/projects', () => {
    it('trả về danh sách dự án kèm số liệu usage thật', async () => {
      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.projects)).toBe(true);
      expect(res.body.totals).toBeDefined();

      for (const project of res.body.projects) {
        expect(project).toHaveProperty('id');
        expect(project).toHaveProperty('name');
        expect(typeof project.totalTokens).toBe('number');
        expect(typeof project.totalCost).toBe('number');
        expect(typeof project.systemSharePercent).toBe('number');
        expect(typeof project.environment).toBe('string');
        expect(Array.isArray(project.models)).toBe(true);
      }
    });

    it('tổng phân bổ token khớp với tổng toàn hệ thống', async () => {
      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${accessToken}`);

      const projectTokens = res.body.projects.reduce(
        (sum: number, p: { totalTokens: number }) => sum + p.totalTokens,
        0,
      );
      expect(projectTokens).toBe(res.body.totals.totalTokens);
    });

    it('trả về 404 khi dự án không tồn tại', async () => {
      const res = await request(app)
        .get('/api/projects/khong-ton-tai')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/budgets', () => {
    it('trả về tổng quan ngân sách của chu kỳ hiện tại', async () => {
      const res = await request(app)
        .get('/api/budgets')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.period).toHaveProperty('label');
      expect(typeof res.body.totalLimit).toBe('number');
      expect(typeof res.body.threshold).toBe('number');
      expect(typeof res.body.spent).toBe('number');
      expect(typeof res.body.percent).toBe('number');
      expect(typeof res.body.forecast).toBe('number');
      expect(Array.isArray(res.body.providers)).toBe(true);
      expect(Array.isArray(res.body.projects)).toBe(true);
    });

    it('ngưỡng cảnh báo không vượt quá hạn mức tổng', async () => {
      const res = await request(app)
        .get('/api/budgets')
        .set('Authorization', `Bearer ${accessToken}`);

      if (res.body.totalLimit > 0) {
        expect(res.body.threshold).toBeLessThanOrEqual(res.body.totalLimit);
      }
    });

    it('tổng hạn mức theo nhà cung cấp khớp hạn mức tổng', async () => {
      const res = await request(app)
        .get('/api/budgets')
        .set('Authorization', `Bearer ${accessToken}`);

      const providerLimit = res.body.providers.reduce(
        (sum: number, p: { limit: number }) => sum + p.limit,
        0,
      );
      expect(providerLimit).toBe(res.body.totalLimit);
    });
  });
});
