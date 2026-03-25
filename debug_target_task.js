const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const taskId = 'd89b5bf7-80c3-4a1f-9a3b-24a97ab0b90f';
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        subTasks: true,
        attachments: true,
        comments: true,
        taskTags: { include: { tag: true } }
      }
    });

    if (task) {
      console.log('Task Title:', task.title);
      console.log('Subtasks:', task.subTasks.length);
      console.log('Attachments:', task.attachments.length);
      console.log('Comments:', task.comments.length);
      console.log('Tags:', task.taskTags.length);
    } else {
      console.log('Task NOT FOUND:', taskId);
    }

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
