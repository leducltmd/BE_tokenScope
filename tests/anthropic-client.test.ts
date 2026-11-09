import { afterEach, describe, expect, it, vi } from 'vitest';

// Phải đặt biến môi trường TRƯỚC khi `config` được nạp để client dùng đúng
// khoá trong các test mock này.
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-test-1234567890';
  process.env.ANTHROPIC_ADMIN_API_KEY = 'sk-ant-admin-test-1234567890';
});

import {
  checkProviderConnection,
  fetchProviderUsage,
} from '../src/modules/providers/providers.client';
import {
  buildAnthropicHeaders,
  resolveAnthropicKey,
  toAnthropicError,
} from '../src/modules/providers/anthropic.client';

/**
 * Kiểm thử tích hợp Anthropic Claude — hai loại khoá tách biệt.
 *
 * `fetch` được mock để ghi lại URL + header gửi đi và trả về payload đúng
 * theo tài liệu Anthropic Admin API.
 */

const SECRET_KEY = 'sk-ant-secret-user-1234';
const ADMIN_KEY = 'sk-ant-admin-user-9876';

interface Captured {
  url: URL;
  apiKey: string;
  headers: Record<string, string>;
}

/** Cài mock fetch, trả về danh sách request đã ghi lại. */
function mockFetch(
  handler: (url: URL, init: RequestInit) => { status: number; body: any },
): Captured[] {
  const captured: Captured[] = [];

  vi.stubGlobal('fetch', async (input: any, init: any) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    captured.push({ url, apiKey: headers['x-api-key'] ?? '', headers });

    const { status, body } = handler(url, init ?? {});
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as any;
  });

  return captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Anthropic — header & chọn khoá', () => {
  it('dựng đúng header bắt buộc của Anthropic', () => {
    const headers = buildAnthropicHeaders('secret', {
      apiKey: SECRET_KEY,
    });

    expect(headers['x-api-key']).toBe(SECRET_KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['Content-Type']).toBe('application/json');
    // Không có Workspace ID → không gửi header workspace.
    expect(headers['anthropic-workspace-id']).toBeUndefined();
  });

  it('gửi header anthropic-workspace-id khi có Workspace ID', () => {
    const headers = buildAnthropicHeaders('secret', {
      apiKey: SECRET_KEY,
      workspaceId: 'wsp_123',
    });

    expect(headers['anthropic-workspace-id']).toBe('wsp_123');
  });

  it('không dùng Secret API Key thay cho Admin API Key và ngược lại', () => {
    const credentials = {
      apiKey: SECRET_KEY,
      adminApiKey: ADMIN_KEY,
    };

    expect(resolveAnthropicKey('secret', credentials)).toBe(SECRET_KEY);
    expect(resolveAnthropicKey('admin', credentials)).toBe(ADMIN_KEY);

    // Chỉ có Secret API Key → Admin request KHÔNG được tự ý dùng khoá này.
    const onlySecret = { apiKey: SECRET_KEY };
    expect(resolveAnthropicKey('admin', onlySecret)).not.toBe(SECRET_KEY);
  });

  it('phân biệt lỗi Admin API Key với lỗi Secret API Key', () => {
    const adminError = toAnthropicError(
      { status: 401, body: { error: { message: 'invalid x-api-key' } } },
      'admin',
    );
    expect(adminError.kind).toBe('unauthorized');
    expect(adminError.message).toContain('Admin API Key');

    const secretError = toAnthropicError(
      { status: 401, body: { error: { message: 'invalid x-api-key' } } },
      'secret',
    );
    expect(secretError.message).toContain('Secret API Key');
  });

  it('báo thiếu quyền tổ chức riêng cho Admin API Key (403)', () => {
    const error = toAnthropicError(
      { status: 403, body: { error: { message: 'forbidden' } } },
      'admin',
    );

    expect(error.kind).toBe('missingAdminPermissions');
    expect(error.message).toContain('tổ chức');
  });

  it('không coi rate limit / lỗi server là khoá không hợp lệ', () => {
    expect(toAnthropicError({ status: 429, body: null }, 'admin').kind).toBe(
      'rateLimited',
    );
    expect(toAnthropicError({ status: 503, body: null }, 'admin').kind).toBe(
      'serverError',
    );
  });
});

describe('Anthropic — kiểm tra kết nối độc lập hai loại khoá', () => {
  it('Secret API Key hợp lệ dùng để đọc model; Admin API Key dùng cho báo cáo tổ chức', async () => {
    const captured = mockFetch((url) => {
      if (url.pathname === '/v1/models') {
        return {
          status: 200,
          body: {
            data: [
              { id: 'claude-sonnet-4-5' },
              { id: 'claude-opus-4-1' },
            ],
          },
        };
      }
      return {
        status: 200,
        body: { data: [], has_more: false, next_page: null },
      };
    });

    const result = await checkProviderConnection('anthropic', SECRET_KEY, {
      skipCache: true,
      adminApiKey: ADMIN_KEY,
    });

    expect(result.status).toBe('success');
    expect(result.models).toContain('claude-sonnet-4-5');

    // Trạng thái hai loại khoá được báo riêng.
    expect(result.secretKey?.status).toBe('connected');
    expect(result.adminKey?.status).toBe('connected');

    // Model listing dùng Secret API Key; báo cáo tổ chức dùng Admin API Key.
    const modelsCall = captured.find((c) => c.url.pathname === '/v1/models');
    const usageCall = captured.find((c) =>
      c.url.pathname.includes('/organizations/usage_report'),
    );

    expect(modelsCall?.apiKey).toBe(SECRET_KEY);
    expect(usageCall?.apiKey).toBe(ADMIN_KEY);
    expect(usageCall?.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('Secret API Key hợp lệ nhưng thiếu Admin API Key vẫn dùng được', async () => {
    mockFetch((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'claude-sonnet-4-5' }] } };
      }
      return { status: 401, body: { error: { message: 'invalid x-api-key' } } };
    });

    const result = await checkProviderConnection('anthropic', SECRET_KEY, {
      skipCache: true,
    });

    expect(result.secretKey?.status).toBe('connected');
    expect(result.adminKey?.status).toBe('missing');
    // Vẫn kết nối được cho các API thông thường của Claude.
    expect(result.status).toBe('success');
  });

  it('Admin API Key không hợp lệ được báo riêng, không đánh dấu Secret API Key hỏng', async () => {
    mockFetch((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'claude-sonnet-4-5' }] } };
      }
      return { status: 401, body: { error: { message: 'invalid x-api-key' } } };
    });

    const result = await checkProviderConnection('anthropic', SECRET_KEY, {
      skipCache: true,
      adminApiKey: 'sk-ant-admin-wrong-key',
    });

    expect(result.secretKey?.status).toBe('connected');
    expect(result.adminKey?.status).toBe('invalid');
  });

  it('Admin API Key thiếu quyền tổ chức được báo đúng', async () => {
    mockFetch((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'claude-sonnet-4-5' }] } };
      }
      return { status: 403, body: { error: { message: 'forbidden' } } };
    });

    const result = await checkProviderConnection('anthropic', SECRET_KEY, {
      skipCache: true,
      adminApiKey: ADMIN_KEY,
    });

    expect(result.adminKey?.status).toBe('missingPermissions');
    expect(result.status).toBe('missingScope');
  });

  it('Secret API Key chưa scope Workspace → báo thiếu Workspace ID', async () => {
    mockFetch(() => ({
      status: 400,
      body: {
        error: {
          message:
            'This API key is not scoped to a workspace, so this request must ' +
            'include the anthropic-workspace-id header.',
        },
      },
    }));

    const result = await checkProviderConnection('anthropic', SECRET_KEY, {
      skipCache: true,
    });

    expect(result.secretKey?.status).toBe('missingWorkspace');
    expect(result.message).toContain('wsp_');
  });

  it('gửi kèm header anthropic-workspace-id khi có Workspace ID', async () => {
    const captured = mockFetch((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'claude-sonnet-4-5' }] } };
      }
      return { status: 200, body: { data: [], has_more: false } };
    });

    await checkProviderConnection('anthropic', SECRET_KEY, {
      skipCache: true,
      adminApiKey: ADMIN_KEY,
      workspaceId: 'wsp_abc123',
    });

    const modelsCall = captured.find((c) => c.url.pathname === '/v1/models');
    expect(modelsCall?.headers['anthropic-workspace-id']).toBe('wsp_abc123');

    const probe = captured.find((c) => c.url.pathname.endsWith('/usage_report/messages'));
    expect(probe?.headers['anthropic-workspace-id']).toBeUndefined();
    expect(probe?.url.searchParams.get('workspace_ids[]')).toBe('wsp_abc123');
    const start = probe?.url.searchParams.get('starting_at');
    const end = probe?.url.searchParams.get('ending_at');
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    expect(Date.parse(end!) - Date.parse(start!)).toBe(86_400_000);
  });
});

describe('Anthropic — Usage Report & Cost Report', () => {
  it('đọc token và chi phí từ payload chính thức cho workspace đã chọn', async () => {
    const workspaceId = 'wrkspc_test123';
    const captured = mockFetch((url) => {
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
                    cache_creation: {
                      ephemeral_1h_input_tokens: 60,
                      ephemeral_5m_input_tokens: 40,
                    },
                    output_tokens: 500,
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
                  amount: '42.00',
                  currency: 'USD',
                  description: 'Claude Sonnet 4.5 Usage - Input Tokens',
                  workspace_id: workspaceId,
                },
                {
                  model: 'claude-sonnet-4-5',
                  amount: '100.00',
                  currency: 'USD',
                  description: 'Claude Sonnet 4.5 Usage - Output Tokens',
                  workspace_id: 'wrkspc_other',
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

    const usage = await fetchProviderUsage(
      'anthropic',
      SECRET_KEY,
      30,
      ADMIN_KEY,
      workspaceId,
    );

    expect(usage.supported).toBe(true);
    expect(usage.points).toHaveLength(1);

    const point = usage.points[0];
    // 1000 (uncached) + 200 (cache read) + 100 (cache creation)
    expect(point.inputTokens).toBe(1300);
    expect(point.outputTokens).toBe(500);
    expect(point.cost).toBeCloseTo(0.42, 5);
    expect(point.date).toBe('2026-10-01');

    // Cả hai endpoint tổ chức đều dùng Admin API Key.
    const orgCalls = captured.filter((c) => c.url.pathname.includes('/organizations/'));
    expect(orgCalls).toHaveLength(2);
    for (const call of orgCalls) {
      expect(call.apiKey).toBe(ADMIN_KEY);
      expect(call.headers['anthropic-workspace-id']).toBeUndefined();
      expect(call.url.searchParams.get('starting_at')).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(call.url.searchParams.get('ending_at')).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    }
    const usageQuery = captured.find((c) => c.url.pathname.endsWith('/usage_report/messages'))?.url.searchParams;
    expect(usageQuery?.getAll('group_by[]')).toEqual(['model']);
    expect(usageQuery?.get('workspace_ids[]')).toBe(workspaceId);

    const costQuery = captured.find((c) => c.url.pathname.endsWith('/cost_report'))?.url.searchParams;
    expect(costQuery?.getAll('group_by[]')).toEqual(['description', 'workspace_id']);
    expect(costQuery?.has('workspace_ids[]')).toBe(false);
  });

  it('lấy nhiều trang theo cursor chính thức', async () => {
    let page = 0;
    mockFetch((url) => {
      const cursor = url.searchParams.get('page');
      page += 1;

      if (!cursor) {
        return {
          status: 200,
          body: {
            data: [
              {
                starting_at: '2026-10-01T00:00:00Z',
                results: [
                  {
                    model: 'claude-opus-4-1',
                    uncached_input_tokens: 10,
                    output_tokens: 5,
                    request_count: 1,
                  },
                ],
              },
            ],
            has_more: true,
            next_page: 'cursor-2',
          },
        };
      }

      return {
        status: 200,
        body: {
          data: [
            {
              starting_at: '2026-10-02T00:00:00Z',
              results: [
                {
                  model: 'claude-opus-4-1',
                  uncached_input_tokens: 20,
                  output_tokens: 8,
                  request_count: 2,
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        },
      };
    });

    const usage = await fetchProviderUsage(
      'anthropic',
      SECRET_KEY,
      30,
      ADMIN_KEY,
    );

    expect(page).toBeGreaterThanOrEqual(3); // 2 trang usage + các trang cost
    expect(usage.points.length).toBe(2);
    expect(usage.points.map((p) => p.date)).toEqual([
      '2026-10-01',
      '2026-10-02',
    ]);
  });

  it('không dùng Secret API Key cho endpoint tổ chức', async () => {
    const captured = mockFetch((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'claude-sonnet-4-5' }] } };
      }
      return { status: 200, body: { data: [], has_more: false } };
    });

    await fetchProviderUsage('anthropic', SECRET_KEY, 30, ADMIN_KEY);

    for (const call of captured) {
      expect(call.apiKey).not.toBe(SECRET_KEY);
    }
  });

  it('báo rõ khi thiếu quyền đọc báo cáo tổ chức', async () => {
    mockFetch(() => ({
      status: 403,
      body: { error: { message: 'forbidden' } },
    }));

    const usage = await fetchProviderUsage(
      'anthropic',
      SECRET_KEY,
      30,
      ADMIN_KEY,
    );

    expect(usage.supported).toBe(false);
    expect(usage.message).toContain('tổ chức');
  });
});
