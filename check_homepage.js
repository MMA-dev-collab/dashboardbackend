const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const s = await prisma.sprint.findFirst({ where: { name: 'Home Page' } });
    if (s) {
      const t = await prisma.task.count({ where: { sprintId: s.id } });
      console.log('Tasks in Home Page:', t);
    } else {
      console.log('Home Page sprint not found');
    }
  } finally {
    await prisma.$disconnect();
  }
}

run();
