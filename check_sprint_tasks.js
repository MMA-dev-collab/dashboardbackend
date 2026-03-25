const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const tasks = await prisma.task.findMany({
      where: { sprint: { name: 'Sprint 1 MVP' } },
      select: {
          id: true,
          title: true,
          parentId: true,
          projectId: true,
          sprintId: true,
          isArchived: true,
          type: true
      }
    });
    console.log('Sprint 1 MVP Tasks:', tasks.length);
    tasks.forEach(t => {
        console.log(`- Task: "${t.title}" | ParentId: ${t.parentId} | Type: ${t.type} | Archived: ${t.isArchived}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
