const prisma = require('../../config/database');
const { NotFoundError, BadRequestError } = require('../../utils/errors');

class SprintsService {
  async list(projectId) {
    return prisma.sprint.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { tasks: true } }
      }
    });
  }

  async create(data) {
    if (!data.name) throw new BadRequestError('Sprint name is required');
    return prisma.sprint.create({ data });
  }

  async updateStatus(id, status) {
    const sprint = await prisma.sprint.findUnique({ where: { id } });
    if (!sprint) throw new NotFoundError('Sprint not found');
    
    // Additional domain logic e.g. "Cannot start if another sprint is ACTIVE"
    // could be added here.
    return prisma.sprint.update({
      where: { id },
      data: { status }
    });
  }

  async getMetrics(sprintId) {
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: {
        budget: true,
        tasks: {
          include: { column: true }
        }
      }
    });

    if (!sprint) throw new NotFoundError('Sprint not found');

    const totalTasks = sprint.tasks.length;
    let completedTasks = 0;
    let totalStoryPoints = 0;
    let completedStoryPoints = 0;

    sprint.tasks.forEach(task => {
      totalStoryPoints += task.storyPoints;
      // Assuming 'Done' or similar is the marker for a completed task
      if (['Done', 'Completed'].includes(task.column.name)) {
        completedTasks++;
        completedStoryPoints += task.storyPoints;
      }
    });

    return {
      totalTasks,
      completedTasks,
      completionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
      totalStoryPoints,
      completedStoryPoints,
      budget: sprint.budget || null
    };
  }
}

module.exports = new SprintsService();
