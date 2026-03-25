const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const tasks = await prisma.task.findMany({
      select: { id: true, title: true, projectId: true, sprintId: true }
    });
    
    console.log('--- POTENTIALLY CORRUPTED TASKS ---');
    tasks.forEach(t => {
        if (t.projectId.length !== 36) {
            console.log(`ID: ${t.id} | ProjectId: ${t.projectId} | Title: "${t.title}" | SprintId: ${t.sprintId}`);
        }
    });

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
