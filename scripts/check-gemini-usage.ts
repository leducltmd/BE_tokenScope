import { geminiUsageMetrics, googleProjectIdPattern, readGeminiUsage } from '../src/modules/providers/gemini-usage.service';

async function main(): Promise<void> {
  const [project, rawDays = '30'] = process.argv.slice(2);
  const days = Number(rawDays);
  if (!project || !googleProjectIdPattern.test(project) ||
      !Number.isInteger(days) || days < 1 || days > 30) {
    throw new Error('Dùng npm run gemini:usage -- <Google Cloud project ID> [1–30 ngày].');
  }
  const accessToken = process.env.GEMINI_MONITORING_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new Error('Cần OAuth access token có quyền đọc Cloud Monitoring trong GEMINI_MONITORING_ACCESS_TOKEN.');
  }

  const { start, end, metrics: results } = await readGeminiUsage(project, accessToken, days);
  console.log(`Google Cloud project ${project} · ${start.toISOString()} → ${end.toISOString()}`);
  for (const [index, [label]] of geminiUsageMetrics.entries()) {
    const result = results[index];
    console.log(label);
    if (result.status === 'rejected') {
      console.error(result.reason instanceof Error ? result.reason.message : 'Không đọc được metric.');
      process.exitCode = 1;
      continue;
    }
    if (result.value.size === 0) console.log('  Chưa có dữ liệu metric trong khoảng đã chọn.');
    for (const [model, tokens] of result.value) console.log(`  ${model}: ${tokens}`);
    if (index === 0 && result.value.size > 0) {
      const total = [...result.value.values()].reduce((sum, tokens) => sum + tokens, 0n);
      console.log(`  Tổng output tokens: ${total}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Không đọc được usage Gemini.');
  process.exitCode = 1;
});
