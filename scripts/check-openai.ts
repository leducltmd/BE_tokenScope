/**
 * Script kiểm thử tích hợp thật với OpenAI API.
 *
 * Chạy: npx tsx scripts/check-openai.ts
 *
 * Yêu cầu: OPENAI_API_KEY và OPENAI_ADMIN_API_KEY trong file .env.
 * Script KHÔNG in ra giá trị khoá.
 */
import { config } from '../src/config';
import {
  fetchOpenAICosts,
  fetchOpenAIModels,
  fetchOpenAIUsage,
} from '../src/modules/providers/providers.client';

function line(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  console.log(
    `Cấu hình: secret=${config.openai.apiKey ? 'có' : 'KHÔNG'} | ` +
      `admin=${config.openai.adminApiKey ? 'có' : 'KHÔNG'} | ` +
      `orgAccess=${config.openai.orgAccessEnabled}`,
  );

  // 1. Danh sách model (Secret API Key).
  line('1. GET /v1/models (Secret API Key)');
  const models = await fetchOpenAIModels();
  console.log(`ok=${models.ok} — ${models.message}`);
  if (models.models.length > 0) {
    console.log(`   ${models.models.slice(0, 5).join(', ')}`);
  }
  if (models.error) {
    console.log(`   kind=${models.error.kind} http=${models.error.httpStatus}`);
  }

  // 2. Usage (Admin API Key).
  line('2. GET /v1/organization/usage/completions (Admin API Key)');
  const now = Math.floor(Date.now() / 1000);
  const usage = await fetchOpenAIUsage({
    startTime: now - 30 * 24 * 60 * 60,
    endTime: now,
    bucketWidth: '1d',
    groupBy: ['model', 'project_id'],
  });
  console.log(`supported=${usage.supported} — ${usage.message}`);
  if (usage.error) {
    console.log(`   kind=${usage.error.kind} http=${usage.error.httpStatus}`);
    console.log(`   detail=${usage.error.detail ?? ''}`);
  } else {
    console.log(
      `   input=${usage.totals.inputTokens} output=${usage.totals.outputTokens} ` +
        `total=${usage.totals.totalTokens} req=${usage.totals.requests}`,
    );
    console.log(`   pages=${usage.pagination.pages} points=${usage.points.length}`);
    for (const m of usage.byModel.slice(0, 5)) {
      console.log(`   model=${m.model} tokens=${m.totalTokens} req=${m.requests}`);
    }
  }

  // 3. Costs (Admin API Key).
  line('3. GET /v1/organization/costs (Admin API Key)');
  const costs = await fetchOpenAICosts({
    startTime: now - 30 * 24 * 60 * 60,
    endTime: now,
    groupBy: ['line_item', 'project_id'],
  });
  console.log(`supported=${costs.supported} — ${costs.message}`);
  if (costs.error) {
    console.log(`   kind=${costs.error.kind} http=${costs.error.httpStatus}`);
    console.log(`   detail=${costs.error.detail ?? ''}`);
  } else {
    console.log(
      `   amount=${costs.totals.amount} currency=${costs.totals.currency}`,
    );
    console.log(`   pages=${costs.pagination.pages} points=${costs.points.length}`);
    for (const l of costs.byLineItem.slice(0, 5)) {
      console.log(`   lineItem=${l.lineItem} amount=${l.amount}`);
    }
  }
}

main().catch((error) => {
  console.error('Lỗi:', error instanceof Error ? error.message : error);
  process.exit(1);
});
