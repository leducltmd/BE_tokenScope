import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_PASSWORD = '123456';

/** Xoá dữ liệu cũ theo thứ tự phụ thuộc rồi tạo dữ liệu mẫu. */
async function main(): Promise<void> {
  console.log('[TokenScope] Bắt đầu nạp dữ liệu mẫu...');

  await prisma.usageRecord.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.apiProvider.deleteMany();
  await prisma.project.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const user = await prisma.user.create({
    data: {
      email: 'demo@tokenscope.io',
      name: 'Nguyễn Minh Anh',
      birthDate: new Date('1995-05-20T00:00:00.000Z'),
      passwordHash,
      isVerified: true,
      lastLoginAt: new Date(),
    },
  });

  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name: 'Ứng dụng Chat',
      description: 'Dự án mẫu cho TokenScope',
      color: '#6366F1',
    },
  });

  const providers = await Promise.all(
    [
      { name: 'OpenAI GPT-4o', type: 'openai', baseUrl: 'https://api.openai.com/v1' },
      { name: 'Anthropic Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com' },
      { name: 'Google Gemini', type: 'google', baseUrl: 'https://generativelanguage.googleapis.com' },
    ].map((p) =>
      prisma.apiProvider.create({
        data: {
          userId: user.id,
          projectId: project.id,
          name: p.name,
          providerType: p.type,
          baseUrl: p.baseUrl,
          apiKeyLast4: '••••',
          status: 'active',
        },
      }),
    ),
  );

  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  await prisma.budget.createMany({
    data: providers.map((provider, index) => ({
      userId: user.id,
      apiProviderId: provider.id,
      monthlyLimit: [500, 300, 200][index],
      currentSpend: [128.4, 76.2, 0][index],
      warningPercent: 80,
      periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
      periodEnd: monthEnd,
    })),
  });

  await prisma.alert.createMany({
    data: [
      {
        userId: user.id,
        apiProviderId: providers[0].id,
        type: 'budget_threshold',
        threshold: 400,
        isEnabled: true,
      },
      {
        userId: user.id,
        apiProviderId: providers[1].id,
        type: 'latency_spike',
        threshold: 3000,
        isEnabled: true,
      },
      {
        userId: user.id,
        type: 'daily_summary',
        isEnabled: false,
      },
    ],
  });

  // 14 ngày dữ liệu sử dụng, mỗi ngày 4 lần gọi.
  const usageRecords: {
    userId: string;
    projectId: string;
    apiProviderId: string;
    model: string;
    endpoint: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    latencyMs: number;
    statusCode: number;
    isSuccess: boolean;
    occurredAt: Date;
  }[] = [];

  const models = ['gpt-4o', 'claude-3-5-sonnet', 'gemini-1.5-pro'];

  for (let day = 13; day >= 0; day--) {
    for (let call = 0; call < 4; call++) {
      const providerIndex = (day + call) % providers.length;
      const promptTokens = 800 + ((day * 137 + call * 211) % 3200);
      const completionTokens = 300 + ((day * 89 + call * 143) % 1400);
      const totalTokens = promptTokens + completionTokens;
      const failed = (day + call) % 13 === 0;

      usageRecords.push({
        userId: user.id,
        projectId: project.id,
        apiProviderId: providers[providerIndex].id,
        model: models[providerIndex],
        endpoint: '/v1/chat/completions',
        promptTokens,
        completionTokens,
        totalTokens,
        cost: Number(((totalTokens / 1000) * 0.012).toFixed(6)),
        latencyMs: 420 + ((day * 71 + call * 133) % 1800),
        statusCode: failed ? 429 : 200,
        isSuccess: !failed,
        occurredAt: new Date(
          now.getTime() - day * 24 * 60 * 60 * 1000 + call * 5 * 60 * 60 * 1000,
        ),
      });
    }
  }

  await prisma.usageRecord.createMany({ data: usageRecords });

  console.log('[TokenScope] Nạp dữ liệu mẫu thành công.');
  console.log(`  Tài khoản demo : ${user.email} / ${DEMO_PASSWORD}`);
  console.log(`  Người dùng     : 1`);
  console.log(`  Dự án         : 1`);
  console.log(`  Nhà cung cấp   : ${providers.length}`);
  console.log(`  Bản ghi usage  : ${usageRecords.length}`);
}

main()
  .catch((error) => {
    console.error('[TokenScope] Nạp dữ liệu mẫu thất bại:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
