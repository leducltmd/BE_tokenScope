/**
 * Kiểm thử tích hợp đầy đủ (full-stack) với một server giả lập trả về đúng
 * cấu trúc response của OpenAI.
 *
 * Mục đích: xác nhận URL, header, query param, phân trang và cách parse
 * response đều đúng — không cần khoá OpenAI thật.
 *
 * Chạy: npx tsx scripts/mock-openai-check.ts
 */
import { createServer } from 'node:http';

const PORT = 3222;

interface Seen {
  url: string;
  auth: string;
}

const seen: Seen[] = [];

/** Server giả lập — trả về payload đúng theo tài liệu OpenAI. */
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  seen.push({
    url: req.url ?? '',
    auth: (req.headers.authorization as string) ?? '',
  });

  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // GET /v1/models
  if (url.pathname === '/v1/models') {
    send(200, {
      object: 'list',
      data: [
        { id: 'gpt-4o', object: 'model' },
        { id: 'gpt-4o-mini', object: 'model' },
      ],
    });
    return;
  }

  // GET /v1/organization/usage/completions — 2 trang để kiểm tra phân trang.
  if (url.pathname === '/v1/organization/usage/completions') {
    const page = url.searchParams.get('page');
    if (!page) {
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
                input_cached_tokens: 400,
                output_tokens: 500,
                num_model_requests: 5,
                model: 'gpt-4o',
                project_id: 'proj_1',
              },
            ],
          },
        ],
        has_more: true,
        next_page: 'page-2',
      });
      return;
    }
    send(200, {
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
    });
    return;
  }

  // GET /v1/organization/costs
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
            {
              object: 'organization.costs.result',
              amount: { value: 0.03, currency: 'usd' },
              line_item: 'gpt-4o, output_tokens',
              project_id: 'proj_1',
              quantity: 500,
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

server.listen(PORT, async () => {
  // Nạp lại config với base URL trỏ về server giả lập.
  process.env.OPENAI_BASE_URL = `http://localhost:${PORT}`;
  process.env.OPENAI_API_KEY = 'sk-secret-mock';
  process.env.OPENAI_ADMIN_API_KEY = 'sk-admin-mock';

  const { fetchOpenAIModels, fetchOpenAIUsage, fetchOpenAICosts } = await import(
    '../src/modules/providers/providers.client'
  );

  console.log('=== 1. Danh sách model (Secret API Key) ===');
  const models = await fetchOpenAIModels();
  console.log(`ok=${models.ok} models=${models.models.join(', ')}`);

  console.log('\n=== 2. Usage (Admin API Key) — có phân trang ===');
  const usage = await fetchOpenAIUsage({
    startTime: 1730419200,
    endTime: 1730592000,
    bucketWidth: '1d',
    groupBy: ['model', 'project_id'],
  });
  console.log(`supported=${usage.supported}`);
  console.log(
    `totals: input=${usage.totals.inputTokens} output=${usage.totals.outputTokens} ` +
      `total=${usage.totals.totalTokens} req=${usage.totals.requests} cached=${usage.totals.cachedInputTokens}`,
  );
  console.log(`pages=${usage.pagination.pages} points=${usage.points.length}`);
  console.log('byModel:', JSON.stringify(usage.byModel));
  console.log('byProject:', JSON.stringify(usage.byProject));

  console.log('\n=== 3. Costs (Admin API Key) ===');
  const costs = await fetchOpenAICosts({
    startTime: 1730419200,
    endTime: 1730592000,
    groupBy: ['line_item', 'project_id'],
  });
  console.log(`supported=${costs.supported}`);
  console.log(
    `totals: amount=${costs.totals.amount} currency=${costs.totals.currency}`,
  );
  console.log('byLineItem:', JSON.stringify(costs.byLineItem));

  console.log('\n=== 4. Các request đã gửi tới OpenAI ===');
  for (const item of seen) {
    console.log(`  ${item.url}`);
    console.log(`     Authorization: ${item.auth}`);
  }

  server.close();
});
