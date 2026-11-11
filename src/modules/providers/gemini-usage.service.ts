import { GoogleAuth } from 'google-auth-library';

const metricPrefix = 'generativelanguage.googleapis.com/';
const googleAuth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/monitoring.read'],
});

type MonitoringPage = {
  nextPageToken?: string;
  executionErrors?: unknown[];
  unreachable?: string[];
  timeSeries?: Array<{
    metric: { labels?: { model?: string; limit_name?: string } };
    points: Array<{ value: { int64Value?: string } }>;
  }>;
};

async function readMetric(
  project: string,
  headers: Record<string, string>,
  metric: string,
  start: Date,
  end: Date,
): Promise<Map<string, bigint>> {
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`);
  url.search = new URLSearchParams({
    filter: `project = "${project}" AND metric.type = "${metricPrefix}${metric}"`,
    'interval.startTime': start.toISOString(),
    'interval.endTime': end.toISOString(),
    'aggregation.alignmentPeriod': '86400s',
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    view: 'FULL',
  }).toString();

  const counts = new Map<string, bigint>();
  let nextPage: string | undefined;
  do {
    if (nextPage) url.searchParams.set('pageToken', nextPage);
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Cloud Monitoring trả HTTP ${response.status} khi đọc ${metric}.`);
    }

    const page = (await response.json()) as MonitoringPage;
    if (page.executionErrors?.length || page.unreachable?.length) {
      throw new Error(`Cloud Monitoring chỉ trả dữ liệu một phần cho ${metric}.`);
    }
    for (const series of page.timeSeries ?? []) {
      const labels = series.metric.labels;
      const model = labels?.model ?? 'unknown';
      // Giữ riêng từng quota limit vì các giới hạn có thể cùng đếm một lượt dùng.
      const group = labels?.limit_name ? `${model} (${labels.limit_name})` : model;
      const tokens = series.points.reduce(
        (sum, point) => sum + BigInt(point.value.int64Value ?? '0'),
        0n,
      );
      counts.set(group, (counts.get(group) ?? 0n) + tokens);
    }
    nextPage = page.nextPageToken;
  } while (nextPage);

  return counts;
}

export const geminiUsageMetrics = [
  ['Token đầu ra (GenerateContent)', 'generate_content_usage_output_token_count'],
  ['Token đầu vào theo quota Free Tier (GenerateContent)', 'quota/generate_content_free_tier_input_token_count/usage'],
] as const;

export const googleProjectIdPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export async function readGeminiUsage(project: string, accessToken: string | undefined, days: number) {
  if (!googleProjectIdPattern.test(project)) {
    throw new Error('Google Cloud Project ID không hợp lệ.');
  }
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const headers = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : Object.fromEntries(await googleAuth.getRequestHeaders('https://monitoring.googleapis.com'));
  const metrics = await Promise.allSettled(
    geminiUsageMetrics.map(([, metric]) => readMetric(project, headers, metric, start, end)),
  );
  return { project, start, end, metrics };
}

