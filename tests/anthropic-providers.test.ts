import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { decryptSecret } from '../src/utils/crypto';

const app = createApp();

const DEMO_EMAIL = 'demo@tokenscope.io';
const DEMO_PASSWORD = '123456';

let accessToken = '';
let userId = '';

/** Một lần gọi HTTP tới Anthropic đã ghi lại. */
interface SeenCall {
  path: string;
  apiKey: string;
  version: string;
  workspaceId?: string;
  query: string;
}

/**
 * Mock Anthropic:
 * - `/v1/models` → 200 với danh sách model.
 * - `/v1/organizations/usage_report/messages` → 200 với một bucket.
 * - `/v1/organizations/cost_report` → 200 với một dòng chi phí.
 */
function mockAnthropic(calls: SeenCall[], options?: { adminStatus?: number }) {
  vi.stubGlobal('fetch', async (input: any, init: any) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;

    calls.push({
      path: url.pathname,
      apiKey: headers['x-api-key'] ?? '',
      version: headers['anthropic-version'] ?? '',
      workspaceId: headers['anthropic-workspace-id'],
      query: url.search,
    });

    const json = (body: unknown, status = 200) =>
      ({
        status,
        ok: status >= 200 && status < 300,
        headers: { get: () => null },
        text: async () => JSON.stringify(body),
      }) as any;

    if (url.pathname === '/v1/models') {
      return json({
        data: [
          { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
          { id: 'claude-opus-4-1', display_name: 'Claude Opus 4.1' },
        ],
      });
    }

    if (url.pathname === '/v1/organizations/usage_report/messages') {
      if (options?.adminStatus && options.adminStatus !== 200) {
        return json(
          { error: { type: 'forbidden', message: 'Missing admin scope' } },
          options.adminStatus,
        );
      }
      return json({
        data: [
          {
            starting_at: '2026-11-01T00:00:00Z',
            ending_at: '2026-11-02T00:00:00Z',
            results: [
              {
                uncached_input_tokens: 1000,
                cache_read_input_tokens: 200,
                cache_creation_input_tokens: 50,
                output_tokens: 300,
                model: 'claude-sonnet-4-5',
                api_key_id: 'key_1',
                workspace_id: 'wsp_1',
                service_tier: 'standard',
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      });
    }

    if (url.pathname === '/v1/organizations/cost_report') {
      return json({
        data: [
          {
            starting_at: '2026-11-01T00:00:00Z',
            ending_at: '2026-11-02T00:00:00Z',
            results: [
              {
                currency: 'USD',
                cost: '0.42',
                model: 'claude-sonnet-4-5',
                service_tier: 'standard',
                api_key_id: 'key_1',
                workspace_id: 'wsp_1',
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      });
    }

    return json({ error: { type: 'not_found' } }, 404);
  });
}

/** Xoá một kết nối cùng toàn bộ bản ghi usage (FK chặn xoá provider). */
async function cleanupProvider(providerId: string) {
  await prisma.usageRecord.deleteMany({ where: { apiProviderId: providerId } });
  await prisma.apiProvider.delete({ where: { id: providerId } });
}

describe('Module Providers — Anthropic Claude hai loại khoá', () => {  beforeAll(async () => {
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

  it('tạo kết nối Claude: Secret key đọc model, Admin key đọc báo cáo tổ chức', async () => {
    const calls: SeenCall[] = [];
    mockAnthropic(calls);

    const secretKey = 'sk-ant-secret-1234567890';
    const adminKey = 'sk-ant-admin-9876543210';

    try {
      const res = await request(app)
        .post('/api/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: `Claude Test ${Date.now()}`,
          providerType: 'anthropic',
          apiKey: secretKey,
          adminApiKey: adminKey,
          workspaceId: 'wsp_abc123',
        });

      expect(res.status).toBe(201);
      expect(res.body.provider.status).toBe('active');
      expect(res.body.provider.secretKeyStatus).toBe('connected');
      expect(res.body.provider.adminKeyStatus).toBe('connected');
      expect(res.body.provider.maskedWorkspaceId).toContain('c123');

      // Khoá không bao giờ được trả về bản rõ.
      expect(res.body.provider).not.toHaveProperty('apiKey');
      expect(res.body.provider).not.toHaveProperty('adminApiKey');
      expect(res.body.provider).not.toHaveProperty('workspaceId');

      // `/v1/models` dùng Secret API Key + header bắt buộc + workspace id.
      const modelsCall = calls.find((c) => c.path === '/v1/models');
      expect(modelsCall).toBeTruthy();
      expect(modelsCall!.apiKey).toBe(secretKey);
      expect(modelsCall!.version).toBe('2023-06-01');
      expect(modelsCall!.workspaceId).toBe('wsp_abc123');

      // Endpoint tổ chức dùng Admin API Key — không dùng Secret key.
      const orgCalls = calls.filter((c) => c.path.startsWith('/v1/organizations'));
      expect(orgCalls.length).toBeGreaterThan(0);
      for (const call of orgCalls) {
        expect(call.apiKey).toBe(adminKey);
        expect(call.apiKey).not.toBe(secretKey);
      }

      // Cả hai khoá được mã hoá riêng biệt trong DB.
      const created = await prisma.apiProvider.findFirstOrThrow({
        where: { userId, providerType: 'anthropic', name: res.body.provider.name },
      });
      expect(decryptSecret(created.apiKeyCipher!)).toBe(secretKey);
      expect(decryptSecret(created.adminKeyCipher!)).toBe(adminKey);
      expect(decryptSecret(created.workspaceIdCipher!)).toBe('wsp_abc123');
      expect(created.adminKeyCipher).not.toContain(adminKey);
      expect(created.apiKeyCipher).not.toContain(secretKey);

      await cleanupProvider(created.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Secret key hợp lệ nhưng Admin key thiếu quyền → báo riêng trạng thái', async () => {
    const calls: SeenCall[] = [];
    mockAnthropic(calls, { adminStatus: 403 });

    try {
      const res = await request(app)
        .post('/api/providers/test')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          providerType: 'anthropic',
          apiKey: 'sk-ant-secret-1234567890',
          adminApiKey: 'sk-ant-admin-9876543210',
        });

      expect(res.status).toBe(200);
      expect(res.body.secretKey.status).toBe('connected');
      expect(res.body.adminKey.status).toBe('missingPermissions');
      // Trạng thái tổng thể không phải "API key không hợp lệ".
      expect(res.body.status).toBe('missingScope');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('thiếu Workspace ID khi Secret key chưa được scope → báo missingWorkspace', async () => {
    vi.stubGlobal('fetch', async (input: any, init: any) => {
      const url = new URL(String(input));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      void headers;

      if (url.pathname === '/v1/models') {
        return {
          status: 400,
          ok: false,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({
              error: {
                type: 'invalid_request_error',
                message:
                  'Your API key is not scoped to a workspace. Please include the anthropic-workspace-id header.',
              },
            }),
        } as any;
      }

      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: async () => JSON.stringify({ data: [], has_more: false }),
      } as any;
    });

    try {
      const res = await request(app)
        .post('/api/providers/test')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          providerType: 'anthropic',
          apiKey: 'sk-ant-secret-1234567890',
        });

      expect(res.status).toBe(200);
      expect(res.body.secretKey.status).toBe('missingWorkspace');
      expect(res.body.message).toContain('Workspace');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('PATCH /api/providers/:id/keys — cập nhật Admin key không ghi đè Secret key', async () => {
    const calls: SeenCall[] = [];
    mockAnthropic(calls);

    const secretKey = 'sk-ant-secret-1234567890';
    const adminKey = 'sk-ant-admin-9876543210';
    const newAdminKey = 'sk-ant-admin-new-5555555555';

    try {
      const created = await request(app)
        .post('/api/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: `Claude Keys ${Date.now()}`,
          providerType: 'anthropic',
          apiKey: secretKey,
          adminApiKey: adminKey,
        })
        .then((r) => r.body.provider);

      // Chỉ gửi Admin API Key mới.
      const res = await request(app)
        .patch(`/api/providers/${created.id}/keys`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ adminApiKey: newAdminKey });

      expect(res.status).toBe(200);
      expect(res.body.provider.maskedAdminApiKey).toContain('5555');

      const fresh = await prisma.apiProvider.findUniqueOrThrow({
        where: { id: created.id },
      });

      // Secret key giữ nguyên — không bị ghi đè.
      expect(decryptSecret(fresh.apiKeyCipher!)).toBe(secretKey);
      // Admin key đã thay.
      expect(decryptSecret(fresh.adminKeyCipher!)).toBe(newAdminKey);
      expect(fresh.adminKeyStatus).toBe('connected');
      expect(fresh.secretKeyStatus).toBe('connected');

      await cleanupProvider(created.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('PATCH /api/providers/:id/keys — xoá được Admin key mà giữ Secret key', async () => {
    const calls: SeenCall[] = [];
    mockAnthropic(calls);

    const secretKey = 'sk-ant-secret-1234567890';

    try {
      const created = await request(app)
        .post('/api/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: `Claude Clear ${Date.now()}`,
          providerType: 'anthropic',
          apiKey: secretKey,
          adminApiKey: 'sk-ant-admin-9876543210',
        })
        .then((r) => r.body.provider);

      const res = await request(app)
        .patch(`/api/providers/${created.id}/keys`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ clearAdminApiKey: true });

      expect(res.status).toBe(200);

      const fresh = await prisma.apiProvider.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(fresh.adminKeyCipher).toBeNull();
      expect(decryptSecret(fresh.apiKeyCipher!)).toBe(secretKey);

      await cleanupProvider(created.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('POST /api/providers/:id/sync — đồng bộ usage & cost từ Cost Report', async () => {
    const calls: SeenCall[] = [];
    mockAnthropic(calls);

    try {
      const created = await request(app)
        .post('/api/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: `Claude Sync ${Date.now()}`,
          providerType: 'anthropic',
          apiKey: 'sk-ant-secret-1234567890',
          adminApiKey: 'sk-ant-admin-9876543210',
        })
        .then((r) => r.body.provider);

      const res = await request(app)
        .post(`/api/providers/${created.id}/sync`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.synced).toBeGreaterThan(0);

      const records = await prisma.usageRecord.findMany({
        where: { apiProviderId: created.id },
      });
      expect(records.length).toBeGreaterThan(0);

      // Prompt tokens = uncached + cache_read + cache_creation.
      const record = records[0];
      expect(record.promptTokens).toBe(1000 + 200 + 50);
      expect(record.completionTokens).toBe(300);
      expect(record.totalTokens).toBe(1000 + 200 + 50 + 300);
      expect(Number(record.cost)).toBeCloseTo(0.42, 5);
      expect(record.model).toBe('claude-sonnet-4-5');

      await cleanupProvider(created.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
