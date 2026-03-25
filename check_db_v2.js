const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const tasks = await prisma.task.findMany({
      select: {
          id: true,
          title: true,
          sprintId: true,
          projectId: true,
          parentId: true,
          isArchived: true
      }
    });
    console.log('TOTAL TASKS:', tasks.length);
    tasks.forEach(t => {
        console.log(`Task: ${t.title}, SprintId: ${t.sprintId}, ParentId: ${t.parentId}, Archived: ${t.isArchived}`);
    });

    const sprints = await prisma.sprint.findMany({
        select: { id: true, name: true }
    });
    console.log('\nSPRINTS:');
    sprints.forEach(s => {
        console.log(`Sprint: ${s.name}, ID: ${s.id}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
