const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const projectId = '652b6175-014a-4ac9-bfeb-7b23168d7884';
    const sprintId = '1c398c35-6b11-463a-95d2-5cc02af7e841';

    // 1. Simulate TasksService.list
    const tasks = await prisma.task.findMany({
      where: { projectId, isArchived: false, parentId: null },
      select: { id: true, title: true, sprintId: true }
    });
    
    console.log(`TASKS RETURNED FOR PROJECT ${projectId}:`, tasks.length);
    const sprintTasks = tasks.filter(t => t.sprintId === sprintId);
    console.log(`TASKS FILTERED FOR SPRINT ${sprintId}:`, sprintTasks.length);
    
    if (sprintTasks.length === 0 && tasks.length > 0) {
        console.log('\nSample Tasks and their SprintIds:');
        tasks.slice(0, 5).forEach(t => {
            console.log(`- "${t.title}" | SprintId: [${t.sprintId}]`);
        });
    }

    // 2. Simulate SprintsService.getMetrics
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: { tasks: true }
    });
    console.log(`\nMETRICS CHECK: Sprint "${sprint?.name}" has ${sprint?.tasks?.length} tasks in relation.`);

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
