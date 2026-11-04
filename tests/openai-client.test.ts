import { afterEach, describe, expect, it, vi } from 'vitest';

// Phải đặt biến môi trường TRƯỚC khi `config` được nạp để client dùng đúng
// khoá trong các test mock này.
vi.hoisted(() => {
  process.env.OPENAI_API_KEY = 'sk-secret-test-1234567890';
  process.env.OPENAI_ADMIN_API_KEY = 'sk-admin-test-1234567890';
});

import {
  checkProviderConnection,
  fetchOpenAICosts,
  fetchOpenAIModels,
  fetchOpenAIUsage,
  fetchProviderUsage,
} from '../src/modules/providers/providers.client';

/**
 * Kiểm thử hình dạng request/response thật của OpenAI API.
 *
 * `fetch` được mock để ghi lại URL + header gửi đi và trả về payload đúng
 * theo tài liệu OpenAI (không dùng dữ liệu giả trong code production).
 */

const SECRET_KEY = 'sk-secret-test-1234567890';
const ADMIN_KEY = 'sk-admin-test-1234567890';

interface Captured {
  url: URL;
  auth: string;
}

/** Cài mock fetch, trả về danh sách request đã ghi lại. */
function mockFetch(
  handler: (url: URL, init: RequestInit) => { status: number; body: any },
): Captured[] {
  const captured: Captured[] = [];

  vi.stubGlobal('fetch', async (input: any, init: any) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    captured.push({ url, auth: headers.Authorization ?? '' });

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

describe('OpenAI — hình dạng request', () => {
  it('dùng Secret API Key cho /v1/models', async () => {
    const captured = mockFetch(() => ({
      status: 200,
      body: { data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] },
    }));

    const result = await fetchOpenAIModels();

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(captured[0].url.pathname).toBe('/v1/models');
    expect(captured[0].auth).toBe(`Bearer ${SECRET_KEY}`);
  });

  it('dùng Admin API Key cho /v1/organization/usage/completions', async () => {
    const captured = mockFetch(() => ({ status: 200, body: { data: [] } }));

    await fetchOpenAIUsage({
      startTime: 1730419200,
      endTime: 1730505600,
      bucketWidth: '1d',
      groupBy: ['model', 'project_id'],
    });

    expect(captured[0].url.pathname).toBe(
      '/v1/organization/usage/completions',
    );
    expect(captured[0].auth).toBe(`Bearer ${ADMIN_KEY}`);

    const q = captured[0].url.searchParams;
    expect(q.get('start_time')).toBe('1730419200');
    expect(q.get('end_time')).toBe('1730505600');
    expect(q.get('bucket_width')).toBe('1d');
    // group_by phải lặp lại, KHÔNG phải `group_by[]`.
    expect(q.getAll('group_by')).toEqual(['model', 'project_id']);
    expect(q.get('group_by[]')).toBeNull();
  });

  it('dùng Admin API Key cho /v1/organization/costs', async () => {
    const captured = mockFetch(() => ({ status: 200, body: { data: [] } }));

    await fetchOpenAICosts({
      startTime: 1730419200,
      endTime: 1730505600,
      groupBy: ['line_item', 'project_id'],
    });

    expect(captured[0].url.pathname).toBe('/v1/organization/costs');
    expect(captured[0].auth).toBe(`Bearer ${ADMIN_KEY}`);
    expect(captured[0].url.searchParams.getAll('group_by')).toEqual([
      'line_item',
      'project_id',
    ]);
  });

  it('truyền project_ids và models dưới dạng query lặp lại', async () => {
    const captured = mockFetch(() => ({ status: 200, body: { data: [] } }));

    await fetchOpenAIUsage({
      startTime: 1730419200,
      projectIds: ['proj_a', 'proj_b'],
      models: ['gpt-4o', 'gpt-4o-mini'],
    });

    const q = captured[0].url.searchParams;
    expect(q.getAll('project_ids')).toEqual(['proj_a', 'proj_b']);
    expect(q.getAll('models')).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });
});

describe('OpenAI — kiểm tra kết nối', () => {
  it('báo success khi Secret key đọc được model và Admin key có quyền', async () => {
    const captured = mockFetch((url) => {
      if (url.pathname === '/v1/models') {
        return {
          status: 200,
          body: { data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] },
        };
      }
      return { status: 200, body: { object: 'page', data: [] } };
    });

    const result = await checkProviderConnection('openai', SECRET_KEY, {
      skipCache: true,
    });

    expect(result.status).toBe('success');
    expect(result.models).toEqual(['gpt-4o', 'gpt-4o-mini']);

    // /v1/models dùng Secret key, /organization/usage dùng Admin key.
    const modelsCall = captured.find((c) => c.url.pathname === '/v1/models');
    const usageCall = captured.find((c) =>
      c.url.pathname.includes('/organization/usage/completions'),
    );
    expect(modelsCall?.auth).toBe(`Bearer ${SECRET_KEY}`);
    expect(usageCall?.auth).toBe(`Bearer ${ADMIN_KEY}`);
  });

  it('báo missingScope khi Admin key bị OpenAI từ chối 403', async () => {
    mockFetch((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'gpt-4o' }] } };
      }
      return {
        status: 403,
        body: { error: { message: 'Missing required scope.' } },
      };
    });

    const result = await checkProviderConnection('openai', SECRET_KEY, {
      skipCache: true,
    });

    expect(result.status).toBe('missingScope');
    expect(result.models).toEqual(['gpt-4o']);
    // Thông điệp phải hướng người dùng kiểm tra lại khoá admin của tổ chức.
    expect(result.message).toContain('Admin API Key');
    expect(result.message).toContain('Usage & Costs');
  });

  it('báo missingScope khi chưa cấu hình Admin key nào', async () => {
    const original = process.env.OPENAI_ADMIN_API_KEY;
    delete process.env.OPENAI_ADMIN_API_KEY;

    try {
      mockFetch((url) => {
        if (url.pathname === '/v1/models') {
          return { status: 200, body: { data: [{ id: 'gpt-4o' }] } };
        }
        return { status: 0, body: null, networkError: 'ADMIN_API_KEY_NOT_CONFIGURED' };
      });

      const result = await checkProviderConnection('openai', SECRET_KEY, {
        skipCache: true,
      });

      expect(result.status).toBe('missingScope');
      expect(result.message).toContain('Admin API Key');
    } finally {
      process.env.OPENAI_ADMIN_API_KEY = original;
    }
  });

  it('dùng Admin API Key của người dùng thay cho khoá của máy chủ', async () => {
    const captured = mockFetch((url) => {
      if (url.pathname === '/v1/models') {
        return { status: 200, body: { data: [{ id: 'gpt-4o' }] } };
      }
      return { status: 200, body: { object: 'page', data: [] } };
    });

    const userAdminKey = 'sk-admin-user-own-key';
    const result = await checkProviderConnection('openai', SECRET_KEY, {
      skipCache: true,
      adminApiKey: userAdminKey,
    });

    expect(result.status).toBe('success');

    const modelsCall = captured.find((c) => c.url.pathname === '/v1/models');
    const usageCall = captured.find((c) =>
      c.url.pathname.includes('/organization/usage/completions'),
    );

    // Secret key của người dùng cho /v1/models, admin key của họ cho usage.
    expect(modelsCall?.auth).toBe(`Bearer ${SECRET_KEY}`);
    expect(usageCall?.auth).toBe(`Bearer ${userAdminKey}`);
  });

  it('báo invalidKey khi Secret key bị OpenAI từ chối 401', async () => {
    mockFetch(() => ({
      status: 401,
      body: { error: { message: 'Incorrect API key provided.' } },
    }));

    const result = await checkProviderConnection('openai', SECRET_KEY, {
      skipCache: true,
    });

    expect(result.status).toBe('invalidKey');
    expect(result.httpStatus).toBe(401);
  });

  it('không dùng Admin key cho endpoint model', async () => {
    const captured = mockFetch(() => ({
      status: 200,
      body: { data: [{ id: 'gpt-4o' }] },
    }));

    await checkProviderConnection('openai', SECRET_KEY, { skipCache: true });

    const modelsCall = captured.find((c) => c.url.pathname === '/v1/models');
    expect(modelsCall?.auth).not.toContain(ADMIN_KEY);
  });
});

describe('OpenAI — phân trang', () => {
  it('lấy hết các trang qua next_page', async () => {
    let call = 0;
    const captured = mockFetch(() => {
      call += 1;
      if (call === 1) {
        return {
          status: 200,
          body: {
            object: 'page',
            data: [
              {
                object: 'bucket',
                start_time: 1730419200,
                end_time: 1730505600,
                results: [
                  {
                    object: 'organization.usage.completions.result',
                    input_tokens: 100,
                    output_tokens: 50,
                    num_model_requests: 2,
                    model: 'gpt-4o',
                    project_id: 'proj_1',
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
          object: 'page',
          data: [
            {
              object: 'bucket',
              start_time: 1730505600,
              end_time: 1730592000,
              results: [
                {
                  object: 'organization.usage.completions.result',
                  input_tokens: 200,
                  output_tokens: 80,
                  num_model_requests: 3,
                  model: 'gpt-4o-mini',
                  project_id: 'proj_1',
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        },
      };
    });

    const result = await fetchOpenAIUsage({ startTime: 1730419200 });

    expect(result.supported).toBe(true);
    expect(result.pagination.pages).toBe(2);
    expect(result.points).toHaveLength(2);
    expect(result.totals.inputTokens).toBe(300);
    expect(result.totals.outputTokens).toBe(130);
    expect(result.totals.totalTokens).toBe(430);
    expect(result.totals.requests).toBe(5);

    // Trang 2 phải mang con trỏ của trang 1.
    expect(captured[1].url.searchParams.get('page')).toBe('cursor-2');

    // Gom nhóm theo model giữ lại thông tin phân nhóm.
    expect(result.byModel.map((m) => m.model)).toEqual([
      'gpt-4o-mini',
      'gpt-4o',
    ]);
    expect(result.byProject[0].projectId).toBe('proj_1');
  });

  it('đọc đúng trường amount/currency của Costs API', async () => {
    mockFetch(() => ({
      status: 200,
      body: {
        object: 'page',
        data: [
          {
            object: 'bucket',
            start_time: 1730419200,
            end_time: 1730505600,
            results: [
              {
                object: 'organization.costs.result',
                amount: { value: 0.06, currency: 'usd' },
                line_item: 'gpt-4o, input_tokens',
                project_id: 'proj_1',
                quantity: 1000,
                quantity_unit: 'tokens',
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      },
    }));

    const result = await fetchOpenAICosts({ startTime: 1730419200 });

    expect(result.supported).toBe(true);
    expect(result.points[0].amount).toBe(0.06);
    expect(result.points[0].currency).toBe('usd');
    expect(result.points[0].lineItem).toBe('gpt-4o, input_tokens');
    expect(result.points[0].model).toBe('gpt-4o');
    expect(result.points[0].quantity).toBe(1000);
    expect(result.totals.amount).toBeCloseTo(0.06, 10);
    expect(result.totals.currency).toBe('usd');
    expect(result.byLineItem[0].lineItem).toBe('gpt-4o, input_tokens');
  });
});

describe('OpenAI — xử lý lỗi', () => {
  it('401 → API Key không hợp lệ', async () => {
    mockFetch(() => ({
      status: 401,
      body: { error: { message: 'Incorrect API key provided.' } },
    }));

    const result = await fetchOpenAIUsage({ startTime: 1730419200 });

    expect(result.supported).toBe(false);
    expect(result.error?.kind).toBe('unauthorized');
    expect(result.error?.httpStatus).toBe(401);
  });

  it('403 → thiếu quyền Organization', async () => {
    mockFetch(() => ({
      status: 403,
      body: { error: { message: 'Missing required scope.' } },
    }));

    const result = await fetchOpenAIUsage({ startTime: 1730419200 });

    expect(result.supported).toBe(false);
    expect(result.error?.kind).toBe('forbidden');
    expect(result.error?.message).toContain('Admin API Key');
  });

  it('404 → endpoint không tồn tại', async () => {
    mockFetch(() => ({
      status: 404,
      body: { error: { message: 'Unknown resource.' } },
    }));

    const result = await fetchOpenAICosts({ startTime: 1730419200 });

    expect(result.supported).toBe(false);
    expect(result.error?.kind).toBe('notFound');
    expect(result.error?.httpStatus).toBe(404);
  });

  it('429 → vượt giới hạn request', async () => {
    mockFetch(() => ({
      status: 429,
      body: { error: { message: 'Rate limit reached.' } },
    }));

    const result = await fetchOpenAIUsage({ startTime: 1730419200 });

    expect(result.supported).toBe(false);
    expect(result.error?.kind).toBe('rateLimited');
    expect(result.error?.httpStatus).toBe(429);
  });

  it('lỗi mạng → không thể kết nối', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });

    const result = await fetchOpenAIUsage({ startTime: 1730419200 });

    expect(result.supported).toBe(false);
    expect(result.error?.kind).toBe('network');
  });

  it('dữ liệu rỗng → trả về thông điệp rõ ràng, không lỗi', async () => {
    mockFetch(() => ({
      status: 200,
      body: { object: 'page', data: [], has_more: false, next_page: null },
    }));

    const result = await fetchOpenAIUsage({ startTime: 1730419200 });

    expect(result.supported).toBe(true);
    expect(result.points).toHaveLength(0);
    expect(result.message).toContain('không có dữ liệu usage');
  });
});

describe('OpenAI — Admin API Key theo từng kết nối (hướng A)', () => {
  it('fetchProviderUsage dùng admin key của người dùng cho usage và costs', async () => {
    const captured = mockFetch((url) => {
      if (url.pathname.includes('/organization/usage/completions')) {
        return {
          status: 200,
          body: {
            object: 'page',
            data: [
              {
                start_time: 1730419200,
                end_time: 1730505600,
                results: [{ input_tokens: 100, output_tokens: 50, num_model_requests: 2 }],
              },
            ],
            has_more: false,
            next_page: null,
          },
        };
      }
      return {
        status: 200,
        body: { object: 'page', data: [], has_more: false, next_page: null },
      };
    });

    const userAdminKey = 'sk-admin-user-own-key';
    const result = await fetchProviderUsage('openai', SECRET_KEY, 30, userAdminKey);

    expect(result.supported).toBe(true);

    // Mọi request tới endpoint tổ chức đều dùng admin key của người dùng.
    const orgCalls = captured.filter((c) => c.url.pathname.includes('/organization/'));
    expect(orgCalls.length).toBeGreaterThan(0);
    for (const call of orgCalls) {
      expect(call.auth).toBe(`Bearer ${userAdminKey}`);
    }
  });

  it('fallback về khoá của máy chủ khi người dùng không cung cấp admin key', async () => {
    const captured = mockFetch(() => ({
      status: 200,
      body: { object: 'page', data: [], has_more: false, next_page: null },
    }));

    await fetchProviderUsage('openai', SECRET_KEY, 30);

    const orgCalls = captured.filter((c) => c.url.pathname.includes('/organization/'));
    expect(orgCalls.length).toBeGreaterThan(0);
    for (const call of orgCalls) {
      expect(call.auth).toBe(`Bearer ${ADMIN_KEY}`);
    }
  });
});
