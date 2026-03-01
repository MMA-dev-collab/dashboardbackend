const prisma = require('../../config/database');
const { NotFoundError, BadRequestError } = require('../../utils/errors');

class ColumnsService {
  async list(projectId) {
    return prisma.boardColumn.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
  }

  async create(data) {
    if (!data.name) throw new BadRequestError('Column name is required');
    
    // Auto-calculate order to append at end
    const lastCol = await prisma.boardColumn.findFirst({
      where: { projectId: data.projectId },
      orderBy: { order: 'desc' },
      select: { order: true }
    });
    
    const newOrder = lastCol ? lastCol.order + 1 : 0;

    return prisma.boardColumn.create({
      data: {
        ...data,
        order: newOrder
      }
    });
  }

  async update(id, data) {
    const col = await prisma.boardColumn.findUnique({ where: { id } });
    if (!col) throw new NotFoundError('Column not found');
    
    return prisma.boardColumn.update({
      where: { id },
      data
    });
  }

  async delete(id) {
    // Check if column has tasks before deleting
    const tasksCount = await prisma.task.count({ where: { columnId: id, isArchived: false } });
    if (tasksCount > 0) {
      throw new BadRequestError('Cannot delete a column that contains active tasks. Move them first.');
    }
    return prisma.boardColumn.delete({ where: { id } });
  }
}

module.exports = new ColumnsService();
