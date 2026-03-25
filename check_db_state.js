const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDb() {
    const projects = await prisma.project.findMany();
    console.log(`Total projects: ${projects.length}`);
    for (const p of projects) {
        const columns = await prisma.boardColumn.findMany({ where: { projectId: p.id }});
        const tasks = await prisma.task.findMany({ where: { projectId: p.id }});
        console.log(`Project ${p.id} (${p.name}): ${columns.length} columns, ${tasks.length} tasks`);
    }
    prisma.$disconnect();
}

checkDb().catch(console.error);
