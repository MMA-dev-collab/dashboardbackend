const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    const project = await prisma.project.findUnique({
      where: { id: '7a6d128e-f6fb-4c60-9757-3be79b1d6c55' },
      include: {
        boardColumns: true,
        tasks: true
      }
    });
    console.log(JSON.stringify(project, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

check();
