const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const sprints = await prisma.sprint.findMany();
    console.log('--- SPRINTS ---');
    console.log(JSON.stringify(sprints, null, 2));

    const tasks = await prisma.task.findMany({
      select: {
          id: true,
          title: true,
          sprintId: true,
          projectId: true,
          isArchived: true,
          parentId: true
      }
    });
    console.log('\n--- TASKS ---');
    console.log(JSON.stringify(tasks, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
