const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const sprint = await prisma.sprint.findFirst({ where: { name: 'Sprint 1 MVP' } });
    if (!sprint) {
        console.log('Sprint 1 MVP not found');
        return;
    }
    console.log(`Sprint ID: ${sprint.id} | Sprint ProjectId: ${sprint.projectId}`);

    const tasks = await prisma.task.findMany({
      where: { sprintId: sprint.id },
      select: { id: true, title: true, projectId: true }
    });
    
    console.log(`\nTasks in Sprint 1 MVP:`, tasks.length);
    tasks.forEach(t => {
        console.log(`- Task: "${t.title}" | Task ProjectId: ${t.projectId}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
