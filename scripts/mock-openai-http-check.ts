/**
 * Kiểm thử tầng HTTP của TokenScope với server giả lập đóng vai OpenAI.
 *
 * Chạy: npx tsx scripts/mock-openai-http-check.ts
 */
import { createServer } from 'node:http';

const MOCK_PORT = 3223;
const API_PORT = 3224;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${MOCK_PORT}`);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/v1/models') {
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
  process.env.OPENAI_API_KEY = 'sk-secret-mock';
  process.env.OPENAI_ADMIN_API_KEY = 'sk-admin-mock';
  process.env.OPENAI_ORG_ACCESS_ENABLED = 'true';
  process.env.PORT = String(API_PORT);

  const { createApp } = await import('../src/app');
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
  const loginBody = (await login.json()) as any;
  const token = loginBody.accessToken;
  const headers = { Authorization: `Bearer ${token}` };

  console.log('=== GET /api/providers/openai/models ===');
  const models = await fetch(`${base}/providers/openai/models`, { headers });
  console.log(`status=${models.status}`);
  console.log(JSON.stringify(await models.json(), null, 2));

  console.log('\n=== GET /api/providers/openai/usage?days=7&group_by=model,project_id ===');
  const usage = await fetch(
    `${base}/providers/openai/usage?days=7&group_by=model,project_id`,
    { headers },
  );
  console.log(`status=${usage.status}`);
  console.log(JSON.stringify(await usage.json(), null, 2));

  console.log('\n=== GET /api/providers/openai/costs?days=7 ===');
  const costs = await fetch(`${base}/providers/openai/costs?days=7`, { headers });
  console.log(`status=${costs.status}`);
  console.log(JSON.stringify(await costs.json(), null, 2));

  console.log('\n=== GET /api/providers/openai/usage (thiếu token) ===');
  const noAuth = await fetch(`${base}/providers/openai/usage`);
  console.log(`status=${noAuth.status} ${JSON.stringify(await noAuth.json())}`);

  console.log('\n=== GET /api/providers/openai/usage?days=999 (validate) ===');
  const bad = await fetch(`${base}/providers/openai/usage?days=999`, { headers });
  console.log(`status=${bad.status} ${JSON.stringify(await bad.json())}`);

  httpServer.close();
  server.close();
});
