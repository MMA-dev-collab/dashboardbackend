const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const tasks = await prisma.task.findMany({
      select: { id: true, title: true, projectId: true, sprintId: true }
    });
    
    const projectCounts = {};
    tasks.forEach(t => {
        projectCounts[t.projectId] = (projectCounts[t.projectId] || 0) + 1;
    });
    
    console.log('Task counts by ProjectId:');
    console.log(JSON.stringify(projectCounts, null, 2));

    const projects = await prisma.project.findMany({ select: { id: true, title: true } });
    console.log('\nActual Projects in DB:');
    projects.forEach(p => {
        console.log(`- ${p.title} | ID: ${p.id}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
