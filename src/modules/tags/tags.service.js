const prisma = require('../../config/database');
const { NotFoundError, BadRequestError } = require('../../utils/errors');

class TagsService {
  async listByProject(projectId) {
    return prisma.tag.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
    });
  }

  async createTag(projectId, { name, color }) {
    if (!name?.trim()) throw new BadRequestError('Tag name is required');
    return prisma.tag.create({
      data: { projectId, name: name.trim(), color: color || '#6366f1' },
    });
  }

  async deleteTag(tagId) {
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw new NotFoundError('Tag not found');
    await prisma.tag.delete({ where: { id: tagId } });
  }

  async assignTagToTask(taskId, tagId) {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task not found');
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw new NotFoundError('Tag not found');
    // Upsert to avoid duplicate error
    return prisma.taskTag.upsert({
      where: { taskId_tagId: { taskId, tagId } },
      create: { taskId, tagId },
      update: {},
      include: { tag: true },
    });
  }

  async removeTagFromTask(taskId, tagId) {
    await prisma.taskTag.deleteMany({ where: { taskId, tagId } });
  }

  async getTaskTags(taskId) {
    return prisma.taskTag.findMany({
      where: { taskId },
      include: { tag: true },
    });
  }
}

module.exports = new TagsService();
