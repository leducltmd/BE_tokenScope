/**
 * Đổi tên hiển thị của tài khoản demo thành "Admin Token Scope".
 *
 * Chạy: npx tsx scripts/rename-demo-admin.ts
 */
import { prisma } from '../src/config/prisma';

const DEMO_EMAIL = 'demo@tokenscope.io';
const NEW_NAME = 'Admin Token Scope';

async function main(): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true, name: true, role: true },
  });

  if (!user) {
    console.log(`Không tìm thấy user ${DEMO_EMAIL}.`);
    return;
  }

  console.log(`Trước: name="${user.name}" role="${user.role}"`);

  await prisma.user.update({
    where: { email: DEMO_EMAIL },
    data: { name: NEW_NAME },
  });

  const updated = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { name: true },
  });
  console.log(`Sau:   name="${updated?.name}"`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
