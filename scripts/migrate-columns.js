const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrate() {
  console.log('Starting migration: Seeding default board columns for existing projects...');
  
  try {
    const projects = await prisma.project.findMany({
      include: {
        boardColumns: { take: 1 }
      }
    });

    console.log(`Found ${projects.length} projects.`);

    for (const project of projects) {
      if (project.boardColumns.length === 0) {
        console.log(`Seeding columns for project: ${project.name} (${project.id})`);
        await prisma.boardColumn.createMany({
          data: [
            { projectId: project.id, name: 'TODO', order: 0 },
            { projectId: project.id, name: 'IN PROGRESS', order: 1 },
            { projectId: project.id, name: 'IN REVIEW', order: 2 },
            { projectId: project.id, name: 'DONE', order: 3 },
          ]
        });
      }
    }

    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
