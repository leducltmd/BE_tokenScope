import { createApp } from './app';
import { config } from './config';
import { disconnectPrisma, prisma } from './config/prisma';

async function bootstrap(): Promise<void> {
  await prisma.$connect();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(
      `[TokenScope] API đang chạy tại http://localhost:${config.port} (${config.env})`,
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[TokenScope] Nhận ${signal}, đang tắt server...`);
    server.close(async () => {
      await disconnectPrisma();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error('[TokenScope] Không thể khởi động server:', error);
  process.exit(1);
});
