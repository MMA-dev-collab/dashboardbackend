const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const sprintName = 'Sprint 1 MVP';
    const sprint = await prisma.sprint.findFirst({ where: { name: sprintName } });
    
    if (!sprint) {
        console.log(`Sprint "${sprintName}" not found.`);
        return;
    }

    console.log(`SPRINT FOUND: ${sprint.name} | ID: ${sprint.id} | ProjectId: ${sprint.projectId}`);

    const tasks = await prisma.task.findMany({
      where: { sprintId: sprint.id },
      include: { column: true }
    });

    console.log(`TOTAL TASKS LINKED TO THIS SPRINT: ${tasks.length}`);
    tasks.forEach(t => {
        console.log(`- Task: "${t.title}" | ID: ${t.id} | ProjectId: ${t.projectId} | ParentId: ${t.parentId} | Column: ${t.column?.name} | Archived: ${t.isArchived}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
