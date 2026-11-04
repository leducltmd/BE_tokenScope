/**
 * Kiểm thử luồng đầy đủ: tạo kết nối OpenAI → kiểm tra → đồng bộ usage.
 *
 * Chạy: npx tsx scripts/mock-openai-flow-check.ts
 */
import { createServer } from 'node:http';

const MOCK_PORT = 3225;
const API_PORT = 3226;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${MOCK_PORT}`);
  const auth = (req.headers.authorization as string) ?? '';
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/v1/models') {
    if (!auth.includes('sk-')) {
      send(401, { error: { message: 'Incorrect API key provided.' } });
      return;
    }
    send(200, { data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] });
    return;
  }

  if (url.pathname === '/v1/organization/usage/completions') {
    send(200, {
      object: 'page',
      data: [
        {
          object: 'bucket',
          start_time: 1730419200,
          end_time: 1730505600,
          results: [
            {
              object: 'organization.usage.completions.result',
              input_tokens: 1000,
              output_tokens: 500,
              num_model_requests: 5,
              model: 'gpt-4o',
              project_id: 'proj_1',
            },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    });
    return;
  }

  if (url.pathname === '/v1/organization/costs') {
    send(200, {
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
    });
    return;
  }

  send(404, { error: { message: 'Unknown resource.' } });
});

server.listen(MOCK_PORT, async () => {
  process.env.OPENAI_BASE_URL = `http://localhost:${MOCK_PORT}`;
  process.env.OPENAI_API_KEY = 'sk-server-secret';
  process.env.OPENAI_ADMIN_API_KEY = 'sk-admin-server';
  process.env.OPENAI_ORG_ACCESS_ENABLED = 'true';

  const { createApp } = await import('../src/app');
  const { prisma } = await import('../src/config/prisma');
  const app = createApp();
  const httpServer = app.listen(API_PORT);
  const base = `http://localhost:${API_PORT}/api`;

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'demo@tokenscope.io',
      password: '123456',
    }),
  });
  const token = ((await login.json()) as any).accessToken;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  console.log('=== 1. POST /api/providers/test (Secret key cua user) ===');
  const test = await fetch(`${base}/providers/test`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      providerType: 'openai',
      apiKey: 'sk-user-supplied-key',
    }),
  });
  console.log(`status=${test.status}`);
  console.log(JSON.stringify(await test.json(), null, 2));

  console.log('\n=== 2. POST /api/providers (tao ket noi) ===');
  const create = await fetch(`${base}/providers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'OpenAI Test Flow',
      providerType: 'openai',
      apiKey: 'sk-user-supplied-key',
    }),
  });
  const created = (await create.json()) as any;
  console.log(`status=${create.status}`);
  console.log(
    JSON.stringify(
      {
        message: created.message,
        provider: {
          id: created.provider?.id,
          providerType: created.provider?.providerType,
          lastCheckStatus: created.provider?.lastCheckStatus,
          usageAvailable: created.provider?.usageAvailable,
          models: created.provider?.models,
          maskedApiKey: created.provider?.maskedApiKey,
        },
      },
      null,
      2,
    ),
  );

  const providerId = created.provider?.id;

  console.log('\n=== 3. POST /api/providers/:id/sync ===');
  const sync = await fetch(`${base}/providers/${providerId}/sync`, {
    method: 'POST',
    headers,
  });
  console.log(`status=${sync.status}`);
  console.log(JSON.stringify(await sync.json(), null, 2));

  console.log('\n=== 3b. Đồng bộ LẠI (kiểm tra không nhân đôi) ===');
  const sync2 = await fetch(`${base}/providers/${providerId}/sync`, {
    method: 'POST',
    headers,
  });
  console.log(`status=${sync2.status}`);
  console.log(JSON.stringify(await sync2.json(), null, 2));

  console.log('\n=== 4. GET /api/providers (so lieu sau khi dong bo) ===');
  const list = await fetch(`${base}/providers`, { headers });
  const listed = (await list.json()) as any;
  const openai = listed.providers?.find((p: any) => p.id === providerId);
  console.log(
    JSON.stringify(
      {
        totals: listed.totals,
        openai: openai
          ? {
              totalTokens: openai.totalTokens,
              totalCost: openai.totalCost,
              requestCount: openai.requestCount,
              usageAvailable: openai.usageAvailable,
              models: openai.models,
            }
          : null,
      },
      null,
      2,
    ),
  );

  if (providerId) {
    await fetch(`${base}/providers/${providerId}`, {
      method: 'DELETE',
      headers,
    });
    console.log('\n(Da xoa ket noi test)');
  }

  await prisma.$disconnect();
  httpServer.close();
  server.close();
});
