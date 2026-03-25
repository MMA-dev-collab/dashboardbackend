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

  async update(id, data) {
    const sprint = await prisma.sprint.findUnique({ where: { id } });
    if (!sprint) throw new NotFoundError('Sprint not found');

    const { startDate, endDate, goal, name } = data;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (goal !== undefined) updateData.goal = goal;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;

    return prisma.sprint.update({ where: { id }, data: updateData });
  }

  async updateStatus(id, status) {
    const sprint = await prisma.sprint.findUnique({ where: { id } });
    if (!sprint) throw new NotFoundError('Sprint not found');
    return prisma.sprint.update({ where: { id }, data: { status } });
  }

  async assignMembers(sprintId, members) {
    const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) throw new NotFoundError('Sprint not found');

    await prisma.sprintMember.deleteMany({ where: { sprintId } });
    if (members && members.length > 0) {
      await prisma.sprintMember.createMany({
        data: members.map(m => ({
          sprintId,
          userId: m.userId,
          role: m.role || 'developer'
        }))
      });
    }
    return prisma.sprintMember.findMany({
      where: { sprintId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, profilePicture: true, jobTitle: true } }
      }
    });
  }

  async getMetrics(sprintId) {
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: {
        budget: true,
        tasks: { include: { column: true } },
        members: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, profilePicture: true, jobTitle: true } }
          }
        }
      }
    });

    if (!sprint) throw new NotFoundError('Sprint not found');

    const totalTasks = sprint.tasks.length;
    let completedTasks = 0;
    let totalStoryPoints = 0;
    let completedStoryPoints = 0;
    let totalEstimatedTime = 0;
    let totalLoggedTime = 0;

    sprint.tasks.forEach(task => {
      totalStoryPoints += task.storyPoints;
      totalEstimatedTime += task.estimatedTime || 0;
      totalLoggedTime += task.loggedTime || 0;
      
      const colName = task.column?.name?.toUpperCase() || '';
      if (colName === 'DONE' || colName === 'COMPLETED') {
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
      totalEstimatedTime,
      totalLoggedTime,
      budget: sprint.budget || null,
      members: sprint.members
    };
  }
}

module.exports = new SprintsService();
