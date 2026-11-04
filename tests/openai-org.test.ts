import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Khoá quyền đọc dữ liệu tổ chức trong test để kết quả không phụ thuộc vào
// biến môi trường của máy đang chạy.
vi.hoisted(() => {
  process.env.OPENAI_ORG_ACCESS_ENABLED = 'false';
});

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import {
  aggregateCostTotals,
  aggregateUsageByModel,
  modelFromLineItem,
  type OpenAICostPoint,
  type OpenAIUsagePoint,
} from '../src/modules/providers/openai.service';
import { unixToDateKey } from '../src/modules/providers/openai.client';

const app = createApp();

const DEMO_EMAIL = 'demo@tokenscope.io';
const DEMO_PASSWORD = '123456';

let accessToken = '';

describe('Module Providers — OpenAI Organization (Usage & Costs)', () => {
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
      const res = await request(app).get('/api/providers/openai/usage');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('MISSING_TOKEN');
    });

    it('từ chối khi token không hợp lệ', async () => {
      const res = await request(app)
        .get('/api/providers/openai/costs')
        .set('Authorization', 'Bearer token-khong-hop-le');

      expect(res.status).toBe(401);
    });
  });

  describe('Validate query', () => {
    it('từ chối bucket_width không hợp lệ', async () => {
      const res = await request(app)
        .get('/api/providers/openai/usage?bucket_width=7d')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('từ chối days vượt quá giới hạn', async () => {
      const res = await request(app)
        .get('/api/providers/openai/usage?days=365')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
    });

    it('từ chối costs với bucket_width không phải 1d', async () => {
      const res = await request(app)
        .get('/api/providers/openai/costs?bucket_width=1h')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
    });

    it('từ chối limit vượt quá giới hạn của costs', async () => {
      const res = await request(app)
        .get('/api/providers/openai/costs?limit=500')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
    });
  });

  describe('Quyền truy cập dữ liệu tổ chức', () => {
    it('từ chối khi chưa bật OPENAI_ORG_ACCESS_ENABLED', async () => {
      const res = await request(app)
        .get('/api/providers/openai/usage')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.message).toContain('OPENAI_ORG_ACCESS_ENABLED');
    });

    it('từ chối costs khi chưa bật quyền tổ chức', async () => {
      const res = await request(app)
        .get('/api/providers/openai/costs')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('Endpoint danh sách model', () => {
    it('yêu cầu token đăng nhập', async () => {
      const res = await request(app).get('/api/providers/openai/models');

      expect(res.status).toBe(401);
    });
  });

  describe('Bảo mật', () => {
    it('không bao giờ trả Admin API Key trong response', async () => {
      const res = await request(app)
        .get('/api/providers/openai/usage')
        .set('Authorization', `Bearer ${accessToken}`);

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/sk-admin/);
      expect(body).not.toMatch(/OPENAI_ADMIN_API_KEY=/);
      expect(res.body.adminApiKey).toBeUndefined();
      expect(res.body.apiKey).toBeUndefined();
    });

    it('không để người dùng truyền URL tuỳ ý', async () => {
      const res = await request(app)
        .get('/api/providers/openai/usage?url=https://evil.example.com')
        .set('Authorization', `Bearer ${accessToken}`);

      // Query lạ bị bỏ qua, không được dùng để gọi endpoint khác.
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });
});

describe('OpenAI — chuẩn hoá dữ liệu', () => {
  it('chuyển Unix giây sang ngày YYYY-MM-DD theo UTC', () => {
    // Mốc dùng trong ví dụ chính thức của OpenAI (bucket 1 ngày).
    expect(unixToDateKey(1730419200)).toBe('2024-11-01');
    expect(unixToDateKey(1730505600)).toBe('2024-11-02');
    expect(unixToDateKey(0)).toBe('1970-01-01');
  });

  it('suy ra model từ line_item của OpenAI', () => {
    expect(modelFromLineItem('gpt-4o, input_tokens')).toBe('gpt-4o');
    expect(modelFromLineItem('Batch API Discounts')).toBe(
      'Batch API Discounts',
    );
    expect(modelFromLineItem(null)).toBeNull();
  });

  it('tổng hợp token usage theo đúng trường của OpenAI', () => {
    const points: OpenAIUsagePoint[] = [
      {
        date: '2026-11-01',
        projectId: 'proj_1',
        model: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        requests: 5,
        cachedInputTokens: 400,
      },
      {
        date: '2026-11-01',
        projectId: 'proj_1',
        model: 'gpt-4o-mini',
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        requests: 2,
        cachedInputTokens: 0,
      },
    ];

    const totals = points.reduce(
      (acc, p) => ({
        inputTokens: acc.inputTokens + p.inputTokens,
        outputTokens: acc.outputTokens + p.outputTokens,
        totalTokens: acc.totalTokens + p.totalTokens,
        requests: acc.requests + p.requests,
        cachedInputTokens: acc.cachedInputTokens + p.cachedInputTokens,
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requests: 0,
        cachedInputTokens: 0,
      },
    );

    expect(totals.inputTokens).toBe(1200);
    expect(totals.outputTokens).toBe(600);
    expect(totals.totalTokens).toBe(1800);
    expect(totals.requests).toBe(7);
    expect(totals.cachedInputTokens).toBe(400);

    const byModel = aggregateUsageByModel(points);
    expect(byModel).toHaveLength(2);
    expect(byModel[0].model).toBe('gpt-4o');
    expect(byModel[0].totalTokens).toBe(1500);
  });

  it('không quy đổi đơn vị tiền tệ khi tổng hợp chi phí', () => {
    const points: OpenAICostPoint[] = [
      {
        date: '2026-11-01',
        projectId: 'proj_1',
        lineItem: 'gpt-4o, input_tokens',
        model: 'gpt-4o',
        amount: 0.06,
        currency: 'usd',
        quantity: 1000,
        quantityUnit: 'tokens',
      },
      {
        date: '2026-11-01',
        projectId: 'proj_1',
        lineItem: 'gpt-4o, output_tokens',
        model: 'gpt-4o',
        amount: 0.03,
        currency: 'usd',
        quantity: 500,
        quantityUnit: 'tokens',
      },
    ];

    const totals = aggregateCostTotals(points);
    expect(totals.amount).toBeCloseTo(0.09, 10);
    expect(totals.currency).toBe('usd');
    expect(totals.byCurrency).toHaveLength(1);
  });

  it('trả amount = null khi có nhiều đơn vị tiền tệ', () => {
    const totals = aggregateCostTotals([
      {
        date: '2026-11-01',
        projectId: null,
        lineItem: null,
        model: null,
        amount: 1,
        currency: 'usd',
        quantity: null,
        quantityUnit: null,
      },
      {
        date: '2026-11-01',
        projectId: null,
        lineItem: null,
        model: null,
        amount: 2,
        currency: 'eur',
        quantity: null,
        quantityUnit: null,
      },
    ]);

    expect(totals.amount).toBeNull();
    expect(totals.currency).toBeNull();
    expect(totals.byCurrency).toHaveLength(2);
  });
});
