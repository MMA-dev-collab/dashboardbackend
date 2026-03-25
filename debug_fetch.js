const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const taskCount = await prisma.task.count();
    console.log('Total Tasks:', taskCount);

    const tagCount = await prisma.tag.count();
    console.log('Total Tags:', tagCount);

    const taskTagCount = await prisma.taskTag.count();
    console.log('Total TaskTags:', taskTagCount);

    // Try a fetch with include
    const sampleTask = await prisma.task.findFirst({
      include: {
        taskTags: { include: { tag: true } },
        subTasks: true,
        attachments: true,
        comments: true
      }
    });

    if (sampleTask) {
      console.log('Sample Task ID:', sampleTask.id);
      console.log('Tags:', sampleTask.taskTags.length);
      console.log('Subtasks:', sampleTask.subTasks.length);
      console.log('Attachments:', sampleTask.attachments.length);
      console.log('Comments:', sampleTask.comments.length);
    } else {
      console.log('No tasks found.');
    }

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
