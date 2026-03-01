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
}

module.exports = new SprintsService();
