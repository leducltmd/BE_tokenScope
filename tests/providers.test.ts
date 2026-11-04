import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { decryptSecret, encryptSecret } from '../src/utils/crypto';

const app = createApp();

const DEMO_EMAIL = 'demo@tokenscope.io';
const DEMO_PASSWORD = '123456';

/** Token truy cập của tài khoản demo — dùng cho các endpoint cần xác thực. */
let accessToken = '';
let userId = '';

describe('Module Providers — API TokenScope', () => {
  beforeAll(async () => {
    await prisma.$connect();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });

    accessToken = login.body.accessToken;
    userId = login.body.user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Xác thực', () => {
    it('từ chối khi thiếu token', async () => {
      const res = await request(app).get('/api/providers');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('MISSING_TOKEN');
    });

    it('từ chối khi token không hợp lệ', async () => {
      const res = await request(app)
        .get('/api/providers')
        .set('Authorization', 'Bearer token-khong-hop-le');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/providers/catalog', () => {
    it('trả về danh mục nhà cung cấp hỗ trợ kết nối', async () => {
      const res = await request(app)
        .get('/api/providers/catalog')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.providers)).toBe(true);
      expect(res.body.providers.length).toBeGreaterThan(0);

      const openai = res.body.providers.find(
        (p: { id: string }) => p.id === 'openai',
      );
      expect(openai).toBeTruthy();
      expect(openai.name).toBe('OpenAI');
      expect(openai.keyHint).toBe('sk-...');
      expect(openai.supportsUsage).toBe(true);
    });
  });

  describe('GET /api/providers', () => {
    it('trả về danh sách kết nối kèm số liệu usage tổng hợp', async () => {
      const res = await request(app)
        .get('/api/providers')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.providers)).toBe(true);
      expect(res.body.totals).toBeTruthy();
      expect(res.body.totals.providerCount).toBe(res.body.providers.length);
      expect(res.body.totals.totalTokens).toBeGreaterThanOrEqual(0);

      for (const provider of res.body.providers) {
        // API key gốc không bao giờ được trả về.
        expect(provider).not.toHaveProperty('apiKey');
        expect(provider).not.toHaveProperty('apiKeyCipher');
        // Admin API Key cũng không bao giờ được trả về bản rõ.
        expect(provider).not.toHaveProperty('adminApiKey');
        expect(provider).not.toHaveProperty('adminKeyCipher');
        expect(provider).not.toHaveProperty('adminApiKeyCipher');
        expect(typeof provider.maskedApiKey === 'string' ||
          provider.maskedApiKey === null).toBe(true);
        expect(typeof provider.maskedAdminApiKey === 'string' ||
          provider.maskedAdminApiKey === null).toBe(true);
      }
    });
  });

  describe('POST /api/providers/test', () => {
    it('validate body — thiếu API key', async () => {
      const res = await request(app)
        .post('/api/providers/test')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ providerType: 'openai' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('validate body — API key quá ngắn', async () => {
      const res = await request(app)
        .post('/api/providers/test')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ providerType: 'openai', apiKey: 'abc' });

      expect(res.status).toBe(400);
    });

    it('báo nhà cung cấp chưa được hỗ trợ', async () => {
      const res = await request(app)
        .post('/api/providers/test')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ providerType: 'khong-ton-tai', apiKey: 'sk-test-1234567890' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('invalidKey');
      expect(res.body.message).toContain('chưa được hỗ trợ');
    });
  });

  describe('POST /api/providers', () => {
    it('validate body — thiếu tên kết nối', async () => {
      const res = await request(app)
        .post('/api/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ providerType: 'openai', apiKey: 'sk-test-1234567890' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('từ chối lưu khoá khi nhà cung cấp chưa được hỗ trợ', async () => {
      const res = await request(app)
        .post('/api/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Kết nối sai',
          providerType: 'khong-ton-tai',
          apiKey: 'sk-test-1234567890',
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('validate body — Admin API Key quá ngắn', async () => {
      const res = await request(app)
        .post('/api/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'OpenAI Test',
          providerType: 'openai',
          apiKey: 'sk-test-1234567890',
          adminApiKey: 'abc',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('lưu Admin API Key mã hoá và dùng đúng khoá khi kiểm tra kết nối', async () => {
      const secretKey = 'sk-secret-user-own-1234';
      const adminKey = 'sk-admin-user-own-9876';

      // Mock OpenAI: /v1/models OK, /organization/usage OK.
      const seenAuth: string[] = [];
      vi.stubGlobal('fetch', async (input: any, init: any) => {
        const url = new URL(String(input));
        const headers = (init?.headers ?? {}) as Record<string, string>;
        seenAuth.push(`${url.pathname}|${headers.Authorization ?? ''}`);
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({
              object: 'page',
              data: [],
              has_more: false,
              next_page: null,
            }),
        } as any;
      });

      try {
        const res = await request(app)
          .post('/api/providers')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            name: `OpenAI Admin ${Date.now()}`,
            providerType: 'openai',
            apiKey: secretKey,
            adminApiKey: adminKey,
          });

        expect(res.status).toBe(201);
        expect(res.body.provider.maskedAdminApiKey).toContain('9876');
        expect(res.body.provider).not.toHaveProperty('adminApiKey');
        expect(res.body.provider).not.toHaveProperty('adminKeyCipher');

        // Khoá lưu trong DB phải được mã hoá, giải mã ra đúng khoá gốc.
        const created = await prisma.apiProvider.findFirstOrThrow({
          where: {
            userId,
            providerType: 'openai',
            name: res.body.provider.name,
          },
        });
        expect(created.adminKeyCipher).toBeTruthy();
        expect(created.adminKeyCipher).not.toContain(adminKey);
        expect(decryptSecret(created.adminKeyCipher!)).toBe(adminKey);
        expect(created.adminKeyLast4).toBe('9876');
        expect(decryptSecret(created.apiKeyCipher!)).toBe(secretKey);

        // Request tới endpoint tổ chức phải dùng admin key của người dùng.
        const orgCall = seenAuth.find((a) => a.includes('/organization/'));
        expect(orgCall).toBeTruthy();
        expect(orgCall).toContain(`Bearer ${adminKey}`);

        // Không dùng admin key để gọi /v1/models.
        const modelsCall = seenAuth.find((a) => a.startsWith('/v1/models'));
        expect(modelsCall).toContain(`Bearer ${secretKey}`);

        await prisma.apiProvider.delete({ where: { id: created.id } });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('POST /api/providers/:id/check', () => {
    it('trả về 404 khi không tìm thấy kết nối', async () => {
      const res = await request(app)
        .post('/api/providers/khong-ton-tai/check')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /api/providers/:id', () => {
    it('trả về 404 khi không tìm thấy kết nối', async () => {
      const res = await request(app)
        .delete('/api/providers/khong-ton-tai')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('Mã hoá API key', () => {
    it('lưu API key dạng mã hoá AES-256-GCM và giải mã được', async () => {
      const apiKey = 'sk-ant-test-1234567890abcdef';
      const cipher = encryptSecret(apiKey);

      expect(cipher).not.toContain(apiKey);
      expect(cipher.split('.')).toHaveLength(3);
      expect(decryptSecret(cipher)).toBe(apiKey);

      // Mỗi lần mã hoá cho ra kết quả khác nhau (IV ngẫu nhiên).
      expect(encryptSecret(apiKey)).not.toBe(cipher);
    });

    it('không lưu bản rõ của API key trong database', async () => {
      const provider = await prisma.apiProvider.create({
        data: {
          userId,
          name: 'Test mã hoá',
          providerType: 'openai',
          apiKeyCipher: encryptSecret('sk-secret-value-1234'),
          apiKeyLast4: '1234',
          status: 'active',
        },
      });

      const fresh = await prisma.apiProvider.findUniqueOrThrow({
        where: { id: provider.id },
      });

      expect(fresh.apiKeyCipher).not.toContain('sk-secret-value');
      expect(fresh.apiKeyLast4).toBe('1234');

      await prisma.apiProvider.delete({ where: { id: provider.id } });
    });

    it('mã hoá Admin API Key riêng và không trả về client', async () => {
      const adminKey = 'sk-admin-org-value-9876';
      const cipher = encryptSecret(adminKey);

      expect(cipher).not.toContain(adminKey);
      expect(decryptSecret(cipher)).toBe(adminKey);

      const provider = await prisma.apiProvider.create({
        data: {
          userId,
          name: 'Test admin key',
          providerType: 'openai',
          apiKeyCipher: encryptSecret('sk-secret-value-1234'),
          apiKeyLast4: '1234',
          adminKeyCipher: cipher,
          adminKeyLast4: '9876',
          status: 'active',
        },
      });

      const fresh = await prisma.apiProvider.findUniqueOrThrow({
        where: { id: provider.id },
      });

      expect(fresh.adminKeyCipher).not.toContain('sk-admin-org-value');
      expect(fresh.adminKeyLast4).toBe('9876');

      // API trả về khoá đã che, không bao giờ trả bản rõ.
      const res = await request(app)
        .get('/api/providers')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const found = res.body.providers.find((p: any) => p.id === provider.id);
      expect(found).toBeTruthy();
      expect(found).not.toHaveProperty('adminApiKey');
      expect(found).not.toHaveProperty('adminKeyCipher');
      expect(found).not.toHaveProperty('apiKeyCipher');
      expect(typeof found.maskedAdminApiKey === 'string').toBe(true);
      expect(found.maskedAdminApiKey).toContain('9876');
      expect(found.maskedAdminApiKey).not.toContain('sk-admin-org-value');

      await prisma.apiProvider.delete({ where: { id: provider.id } });
    });
  });
});
