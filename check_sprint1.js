const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const sprint1Id = '1c398c35-6b11-463a-95d2-5cc02af7e841'; // Adjusted to match the likely ID or pattern
    // Get all sprints to find the exact ID for "Sprint 1 MVP"
    const sprints = await prisma.sprint.findMany();
    const sprint1 = sprints.find(s => s.name === 'Sprint 1 MVP');
    
    if (!sprint1) {
        console.log('Sprint 1 MVP not found in local DB');
        console.log('Available sprints:', sprints.map(s => s.name));
        return;
    }

    console.log(`Found Sprint: ${sprint1.name} (ID: ${sprint1.id})`);

    const tasks = await prisma.task.findMany({
      where: { sprintId: sprint1.id },
      select: {
          id: true,
          title: true,
          columnId: true,
          isArchived: true,
          parentId: true
      }
    });
    
    console.log(`\nTasks in ${sprint1.name}:`, tasks.length);
    tasks.forEach(t => {
        console.log(`- [${t.columnId}] ${t.title} (Parent: ${t.parentId})`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
