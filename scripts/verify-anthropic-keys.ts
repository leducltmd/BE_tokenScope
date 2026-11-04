/**
 * Kiểm chứng end-to-end luồng Claude với hai loại khoá tách biệt.
 *
 * Chạy backend thật (localhost:3000) và mock `fetch` của Anthropic để kiểm tra:
 * 1. Secret API Key được kiểm tra độc lập (đọc /v1/models).
 * 2. Admin API Key được kiểm tra độc lập (đọc usage_report).
 * 3. Hai loại khoá không thay thế được cho nhau.
 * 4. Báo cáo thiếu quyền tổ chức / khoá thiếu Workspace ID đúng.
 * 5. Usage Report + Cost Report được parse và đồng bộ đúng.
 * 6. Khoá được mã hoá trong DB và không bao giờ trả về client.
 *
 * Chạy: npx tsx scripts/verify-anthropic-keys.ts
 */
import request from 'supertest';

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { decryptSecret } from '../src/utils/crypto';

const app = createApp();

const DEMO_EMAIL = 'demo@tokenscope.io';
const DEMO_PASSWORD = '123456';

const SECRET_KEY = 'sk-ant-secret-verify-1234';
const ADMIN_KEY = 'sk-ant-admin-verify-9876';

let accessToken = '';
let userId = '';

function line(title: string) {
  console.log(`\n=== ${title} ===`);
}

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  [OK]   ${message}`);
  } else {
    console.log(`  [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

/** Mock fetch của Anthropic — ghi lại header gửi đi. */
function mockAnthropic(
  handler: (url: URL) => { status: number; body: any },
): Array<{ url: URL; apiKey: string; headers: Record<string, string> }> {
  const captured: Array<{
    url: URL;
    apiKey: string;
    headers: Record<string, string>;
  }> = [];

  (globalThis as any).fetch = async (input: any, init: any) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    captured.push({ url, apiKey: headers['x-api-key'] ?? '', headers });

    const { status, body } = handler(url);
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as any;
  };

  return captured;
}

async function main() {
  await prisma.$connect();

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  accessToken = login.body.accessToken;
  userId = login.body.user.id;

  // ── 1. Secret API Key hợp lệ, Admin API Key hợp lệ ────────────────────
  line('1. Secret API Key + Admin API Key đều hợp lệ');
  {
    const captured = mockAnthropic((url) => {
      if (url.pathname === '/v1/models') {
        return {
          status: 200,
          body: { data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-opus-4-1' }] },
        };
      }
      if (url.pathname.endsWith('/usage_report/messages')) {
        return {
          status: 200,
          body: {
            data: [
              {
                starting_at: '2026-10-01T00:00:00Z',
                results: [
                  {
                    model: 'claude-sonnet-4-5',
                    uncached_input_tokens: 1000,
                    cache_read_input_tokens: 200,
                    cache_creation_input_tokens: 100,
                    output_tokens: 500,
                    request_count: 7,
                    cost_usd: 0.42,
                  },
                ],
              },
            ],
            has_more: false,
            next_page: null,
          },
        };
      }
      return {
        status: 200,
        body: {
          data: [
            {
              starting_at: '2026-10-01T00:00:00Z',
              results: [
                {
                  model: 'claude-sonnet-4-5',
                  cost_usd: 0.42,
                  quantity: 1800,
                  quantity_unit: 'tokens',
                },
              ],
            },
          ],
          currency: 'usd',
          has_more: false,
          next_page: null,
        },
      };
    });

    const res = await request(app)
      .post('/api/providers/test')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        providerType: 'anthropic',
        apiKey: SECRET_KEY,
        adminApiKey: ADMIN_KEY,
      });

    console.log(`  status=${res.body.status} message="${res.body.message}"`);
    assert(res.body.status === 'success', 'Kết nối thành công');
    assert(
      res.body.secretKey?.status === 'connected',
      `Secret API Key connected (${res.body.secretKey?.status})`,
    );
    assert(
      res.body.adminKey?.status === 'connected',
      `Admin API Key connected (${res.body.adminKey?.status})`,
    );
    assert(
      res.body.models.includes('claude-sonnet-4-5'),
      'Đọc được danh sách model Claude',
    );

    const modelsCall = captured.find((c) => c.url.pathname === '/v1/models');
    const usageCall = captured.find((c) =>
      c.url.pathname.includes('/organizations/usage_report'),
    );

    assert(modelsCall?.apiKey === SECRET_KEY, '/v1/models dùng Secret API Key');
    assert(usageCall?.apiKey === ADMIN_KEY, 'usage_report dùng Admin API Key');
    assert(
      usageCall?.headers['anthropic-version'] === '2023-06-01',
      'Gửi đúng header anthropic-version',
    );
    assert(
      usageCall?.headers['Content-Type'] === 'application/json',
      'Gửi đúng header content-type: application/json',
    );
  }

  // ── 2. Secret API Key hợp lệ, thiếu Admin API Key ────────────────────
  line('2. Thiếu Admin API Key');
  {
    mockAnthropic((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'claude-sonnet-4-5' }] } };
      }
      return { status: 401, body: { error: { message: 'invalid x-api-key' } } };
    });

    const res = await request(app)
      .post('/api/providers/test')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ providerType: 'anthropic', apiKey: SECRET_KEY });

    assert(
      res.body.secretKey?.status === 'connected',
      'Secret API Key vẫn connected',
    );
    assert(
      res.body.adminKey?.status === 'missing',
      `Admin API Key = missing (${res.body.adminKey?.status})`,
    );
  }

  // ── 3. Admin API Key không hợp lệ ────────────────────────────────────
  line('3. Admin API Key không hợp lệ');
  {
    mockAnthropic((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'claude-sonnet-4-5' }] } };
      }
      return { status: 401, body: { error: { message: 'invalid x-api-key' } } };
    });

    const res = await request(app)
      .post('/api/providers/test')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        providerType: 'anthropic',
        apiKey: SECRET_KEY,
        adminApiKey: 'sk-ant-admin-wrong-key',
      });

    assert(
      res.body.secretKey?.status === 'connected',
      'Secret API Key KHÔNG bị đánh dấu hỏng',
    );
    assert(
      res.body.adminKey?.status === 'invalid',
      `Admin API Key = invalid (${res.body.adminKey?.status})`,
    );
  }

  // ── 4. Admin API Key thiếu quyền tổ chức ─────────────────────────────
  line('4. Admin API Key thiếu quyền tổ chức');
  {
    mockAnthropic((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'claude-sonnet-4-5' }] } };
      }
      return { status: 403, body: { error: { message: 'forbidden' } } };
    });

    const res = await request(app)
      .post('/api/providers/test')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        providerType: 'anthropic',
        apiKey: SECRET_KEY,
        adminApiKey: ADMIN_KEY,
      });

    assert(
      res.body.adminKey?.status === 'missingPermissions',
      `Admin API Key = missingPermissions (${res.body.adminKey?.status})`,
    );
    assert(
      res.body.status === 'missingScope',
      'Trạng thái tổng = missingScope (không phải invalidKey)',
    );
  }

  // ── 5. Thiếu Workspace ID ────────────────────────────────────────────
  line('5. Secret API Key chưa scope Workspace');
  {
    mockAnthropic(() => ({
      status: 400,
      body: {
        error: {
          message:
            'This API key is not scoped to a workspace, so this request must ' +
            'include the anthropic-workspace-id header.',
        },
      },
    }));

    const res = await request(app)
      .post('/api/providers/test')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ providerType: 'anthropic', apiKey: SECRET_KEY });

    assert(
      res.body.secretKey?.status === 'missingWorkspace',
      `Secret API Key = missingWorkspace (${res.body.secretKey?.status})`,
    );
    assert(
      String(res.body.message).includes('wsp_'),
      'Thông điệp hướng dẫn nhập Workspace ID',
    );
  }

  // ── 6. Gửi header anthropic-workspace-id khi có Workspace ID ─────────
  line('6. Gửi header anthropic-workspace-id');
  {
    const captured = mockAnthropic((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'claude-sonnet-4-5' }] } };
      }
      return { status: 200, body: { data: [], has_more: false } };
    });

    await request(app)
      .post('/api/providers/test')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        providerType: 'anthropic',
        apiKey: SECRET_KEY,
        adminApiKey: ADMIN_KEY,
        workspaceId: 'wsp_verify123',
      });

    const modelsCall = captured.find((c) => c.url.pathname === '/v1/models');
    assert(
      modelsCall?.headers['anthropic-workspace-id'] === 'wsp_verify123',
      `Đã gửi anthropic-workspace-id (${modelsCall?.headers['anthropic-workspace-id']})`,
    );
  }

  // ── 7. Lưu kết nối: mã hoá, tách khoá, đồng bộ usage ─────────────────
  line('7. Lưu kết nối + đồng bộ Usage/Cost Report');
  let createdId = '';
  {
    mockAnthropic((url) => {
      if (url.pathname === '/v1/models') {
        return {
          status: 200,
          body: { data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-opus-4-1' }] },
        };
      }
      if (url.pathname.endsWith('/usage_report/messages')) {
        return {
          status: 200,
          body: {
            data: [
              {
                starting_at: '2026-10-01T00:00:00Z',
                results: [
                  {
                    model: 'claude-sonnet-4-5',
                    uncached_input_tokens: 1000,
                    cache_read_input_tokens: 200,
                    cache_creation_input_tokens: 100,
                    output_tokens: 500,
                    request_count: 7,
                    cost_usd: 0.42,
                  },
                ],
              },
            ],
            has_more: false,
            next_page: null,
          },
        };
      }
      return {
        status: 200,
        body: {
          data: [
            {
              starting_at: '2026-10-01T00:00:00Z',
              results: [
                {
                  model: 'claude-sonnet-4-5',
                  cost_usd: 0.42,
                  quantity: 1800,
                  quantity_unit: 'tokens',
                },
              ],
            },
          ],
          currency: 'usd',
          has_more: false,
          next_page: null,
        },
      };
    });

    const res = await request(app)
      .post('/api/providers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Claude Verify ${Date.now()}`,
        providerType: 'anthropic',
        apiKey: SECRET_KEY,
        adminApiKey: ADMIN_KEY,
        workspaceId: 'wsp_verify123',
      });

    console.log(`  status=${res.status}`);
    assert(res.status === 201, 'Tạo kết nối Claude thành công');

    const provider = res.body.provider;
    createdId = provider.id;

    assert(
      !('apiKey' in provider) &&
        !('apiKeyCipher' in provider) &&
        !('adminApiKey' in provider) &&
        !('adminKeyCipher' in provider) &&
        !('workspaceIdCipher' in provider),
      'API response KHÔNG chứa bản rõ của bất kỳ khoá nào',
    );
    assert(
      provider.maskedApiKey?.includes('1234'),
      `maskedApiKey = ${provider.maskedApiKey}`,
    );
    assert(
      provider.maskedAdminApiKey?.includes('9876'),
      `maskedAdminApiKey = ${provider.maskedAdminApiKey}`,
    );
    assert(
      provider.maskedWorkspaceId?.includes('123'),
      `maskedWorkspaceId = ${provider.maskedWorkspaceId}`,
    );

    // Khoá trong DB phải được mã hoá và tách riêng.
    const row = await prisma.apiProvider.findUniqueOrThrow({
      where: { id: createdId },
    });
    assert(
      row.apiKeyCipher?.includes(SECRET_KEY) === false &&
        decryptSecret(row.apiKeyCipher!) === SECRET_KEY,
      'Secret API Key được mã hoá riêng',
    );
    assert(
      row.adminKeyCipher?.includes(ADMIN_KEY) === false &&
        decryptSecret(row.adminKeyCipher!) === ADMIN_KEY,
      'Admin API Key được mã hoá riêng',
    );
    assert(
      row.workspaceIdCipher?.includes('wsp_verify123') === false &&
        decryptSecret(row.workspaceIdCipher!) === 'wsp_verify123',
      'Workspace ID được mã hoá riêng',
    );
    assert(
      row.secretKeyStatus === 'connected' &&
        row.adminKeyStatus === 'connected',
      `Trạng thái lưu: secret=${row.secretKeyStatus} admin=${row.adminKeyStatus}`,
    );

    // Usage report đã được đồng bộ vào usage_records.
    const records = await prisma.usageRecord.findMany({
      where: { apiProviderId: createdId },
    });
    assert(records.length > 0, `Đã đồng bộ ${records.length} bản ghi usage`);
    if (records.length > 0) {
      const record = records[0];
      assert(
        record.promptTokens === 1300,
        `promptTokens = ${record.promptTokens} (1000+200+100)`,
      );
      assert(
        record.completionTokens === 500,
        `completionTokens = ${record.completionTokens}`,
      );
      assert(
        record.totalTokens === 1800,
        `totalTokens = ${record.totalTokens}`,
      );
      assert(
        Math.abs(Number(record.cost) - 0.42) < 0.0001,
        `cost = ${record.cost}`,
      );
    }
  }

  // ── 8. Đồng bộ lại không nhân đôi dữ liệu ────────────────────────────
  line('8. Đồng bộ lại không nhân đôi');
  {
    mockAnthropic((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'claude-sonnet-4-5' }] } };
      }
      if (url.pathname.endsWith('/usage_report/messages')) {
        return {
          status: 200,
          body: {
            data: [
              {
                starting_at: '2026-10-01T00:00:00Z',
                results: [
                  {
                    model: 'claude-sonnet-4-5',
                    uncached_input_tokens: 1000,
                    cache_read_input_tokens: 200,
                    cache_creation_input_tokens: 100,
                    output_tokens: 500,
                    request_count: 7,
                    cost_usd: 0.42,
                  },
                ],
              },
            ],
            has_more: false,
            next_page: null,
          },
        };
      }
      return {
        status: 200,
        body: {
          data: [
            {
              starting_at: '2026-10-01T00:00:00Z',
              results: [
                { model: 'claude-sonnet-4-5', cost_usd: 0.42, quantity: 1800 },
              ],
            },
          ],
          currency: 'usd',
          has_more: false,
        },
      };
    });

    await request(app)
      .post(`/api/providers/${createdId}/sync`)
      .set('Authorization', `Bearer ${accessToken}`);

    const records = await prisma.usageRecord.findMany({
      where: { apiProviderId: createdId },
    });
    assert(
      records.length === 1,
      `Vẫn đúng 1 bản ghi sau khi đồng bộ lại (${records.length})`,
    );
  }

  // ── 9. Cập nhật Admin API Key độc lập, không ghi đè Secret API Key ────
  line('9. Cập nhật từng loại khoá độc lập');
  {
    mockAnthropic((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'claude-sonnet-4-5' }] } };
      }
      return { status: 200, body: { data: [], has_more: false } };
    });

    const newAdminKey = 'sk-ant-admin-updated-5555';
    const res = await request(app)
      .patch(`/api/providers/${createdId}/keys`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ adminApiKey: newAdminKey });

    console.log(`  status=${res.status}`);
    assert(res.status === 200, 'Cập nhật Admin API Key thành công');

    const row = await prisma.apiProvider.findUniqueOrThrow({
      where: { id: createdId },
    });
    assert(
      decryptSecret(row.adminKeyCipher!) === newAdminKey,
      'Admin API Key đã được thay',
    );
    assert(
      decryptSecret(row.apiKeyCipher!) === SECRET_KEY,
      'Secret API Key KHÔNG bị ghi đè',
    );
    assert(
      decryptSecret(row.workspaceIdCipher!) === 'wsp_verify123',
      'Workspace ID KHÔNG bị ghi đè',
    );
  }

  // ── 10. Danh sách provider không lộ khoá ─────────────────────────────
  line('10. GET /api/providers không lộ khoá');
  {
    const res = await request(app)
      .get('/api/providers')
      .set('Authorization', `Bearer ${accessToken}`);

    const found = res.body.providers.find((p: any) => p.id === createdId);
    assert(found, 'Tìm thấy kết nối trong danh sách');
    assert(
      !('apiKey' in found) &&
        !('apiKeyCipher' in found) &&
        !('adminApiKey' in found) &&
        !('adminKeyCipher' in found) &&
        !('workspaceIdCipher' in found),
      'Danh sách KHÔNG chứa bản rõ của bất kỳ khoá nào',
    );
    assert(
      found.secretKeyStatus === 'connected' &&
        found.adminKeyStatus === 'connected',
      `Trạng thái: secret=${found.secretKeyStatus} admin=${found.adminKeyStatus}`,
    );
  }

  // Dọn dẹp.
  await prisma.usageRecord.deleteMany({ where: { apiProviderId: createdId } });
  await prisma.apiProvider.delete({ where: { id: createdId } });

  await prisma.$disconnect();
  console.log(
    `\n${process.exitCode ? 'CÓ LỖI — xem các dòng [FAIL].' : 'TẤT CẢ KIỂM CHỨNG ĐẠT.'}`,
  );
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
