const prisma = require('../../config/database');
const { NotFoundError, BadRequestError } = require('../../utils/errors');

class TasksService {
  async list(projectId, filters = {}) {
    const where = { projectId, isArchived: false, parentId: null }; // Only root-level tasks on the board
    if (filters.sprintId) where.sprintId = filters.sprintId;
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search } },
        { description: { contains: filters.search } }
      ];
    }

    return prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
        reporter: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
        column: true,
        parent: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getById(id) {
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
        reporter: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
        column: true,
        sprint: true,
        parent: { select: { id: true, title: true } },
        subTasks: {
          include: { 
            assignee: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
            column: { select: { id: true, name: true } }
          }
        },
        attachments: {
          include: { uploader: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } },
          orderBy: { createdAt: 'desc' }
        },
        comments: {
          include: { 
            author: { select: { id: true, firstName: true, profilePicture: true } },
            mentions: { include: { user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } } }
          },
          orderBy: { createdAt: 'desc' }
        },
        history: {
          include: { user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } },
          orderBy: { movedAt: 'desc' },
          take: 20
        },
        taskTags: {
          include: { tag: true }
        }
      }
    });

    if (!task) throw new NotFoundError('Task not found');
    return task;
  }

  async create(data) {
    // Basic assignment validation & cleanup
    data.assigneeId = data.assigneeId === '' ? null : (data.assigneeId || null);
    data.sprintId = data.sprintId === '' ? null : (data.sprintId || null);
    data.parentId = data.parentId === '' ? null : (data.parentId || null);
    
    if (data.dueDate === '') {
      data.dueDate = null;
    } else if (data.dueDate) {
      data.dueDate = new Date(data.dueDate);
    }

    // STORY-only subtask enforcement
    if (data.parentId) {
      const parent = await prisma.task.findUnique({ where: { id: data.parentId } });
      if (!parent) throw new NotFoundError('Parent task not found');
      if (parent.type !== 'STORY') throw new BadRequestError('Subtasks can only be added to Story-type tickets');
    }
    
    return prisma.$transaction(async (tx) => {
      const task = await tx.task.create({ data });
      
      // Initial history log
      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          toColumnId: task.columnId,
          movedBy: data.reporterId
        }
      });

      // Notification for new assignment
      if (data.assigneeId && data.assigneeId !== data.reporterId) {
        await tx.notification.create({
          data: {
            userId: data.assigneeId,
            title: 'New Task Assignment',
            message: `You have been assigned to task: ${task.title}`,
            type: 'task',
            link: `/projects/${task.projectId}?tab=board&taskId=${task.id}`
          }
        });
      }
      
      return task;
    });
  }

  async update(id, data) {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task || task.isArchived) throw new NotFoundError('Task not found');

    // Optimistic locking check if version is provided in update
    if (data.version && task.version !== data.version) {
      throw new BadRequestError('Task has been modified by another user. Please refresh.');
    }

    if (data.assigneeId === '') data.assigneeId = null;
    if (data.sprintId === '') data.sprintId = null;
    if (data.parentId === '') data.parentId = null;
    if (data.dueDate === '') {
      data.dueDate = null;
    } else if (data.dueDate) {
      data.dueDate = new Date(data.dueDate);
    }

    return prisma.$transaction(async (tx) => {
      // Isolate updatedById so we don't try to write it to the DB
      const { updatedById, ...updateData } = data;

      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          ...updateData,
          version: { increment: 1 } // Auto-increment version on every edit
        }
      });

      // Notification for re-assignment
      if (updateData.assigneeId && task.assigneeId !== updateData.assigneeId) {
        // Only trigger if the person making the change isn't the new assignee themselves!
        if (updatedById !== updateData.assigneeId) {
            await tx.notification.create({
              data: {
                userId: updateData.assigneeId,
                title: 'Task Assigned',
                message: `You were assigned to task: ${updatedTask.title}`,
                type: 'task',
                link: `/projects/${updatedTask.projectId}?tab=board&taskId=${updatedTask.id}`,
                actorId: updatedById
              }
            });
        }
      }

      return updatedTask;
    });
  }

  async logTime(taskId, minutes) {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.isArchived) throw new NotFoundError('Task not found');

    return prisma.task.update({
      where: { id: taskId },
      data: {
        loggedTime: { increment: minutes }
      }
    });
  }

  async delete(id) {
    return prisma.task.update({
      where: { id },
      data: { isArchived: true, version: { increment: 1 } }
    });
  }

  // Transactional Move for Drag-and-Drop
  async moveTask(taskId, toColumnId, userId, clientVersion) {
    return prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({ where: { id: taskId } });
      if (!task || task.isArchived) throw new NotFoundError('Task not found');

      // Optimistic Concurrency Control
      if (clientVersion && task.version !== clientVersion) {
        throw new BadRequestError('Conflict: Task was moved by another team member. Board refreshed is required.');
      }

      const fromColumnId = task.columnId;
      if (fromColumnId === toColumnId) return task; // No actual move

      // Verify column exists constraint
      const col = await tx.boardColumn.findUnique({ where: { id: toColumnId } });
      if (!col || col.projectId !== task.projectId) throw new BadRequestError('Invalid destination column');

      // 1. Move Task & bump version
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          columnId: toColumnId,
          version: { increment: 1 }
        },
        include: { column: true }
      });

      // 2. Audit Trail
      await tx.taskHistory.create({
        data: {
          taskId,
          fromColumnId,
          toColumnId,
          movedBy: userId
        }
      });

      return updatedTask;
    });
  }

  async addComment(taskId, authorId, body, mentions = []) {
    return prisma.$transaction(async (tx) => {
      const comment = await tx.taskComment.create({
        data: { taskId, authorId, body },
        include: { author: { select: { firstName: true, lastName: true, profilePicture: true } } }
      });

      if (mentions.length > 0) {
        await tx.commentMention.createMany({
          data: mentions.map(userId => ({ commentId: comment.id, userId }))
        });

        const task = await tx.task.findUnique({ where: { id: taskId }});

        // Notifications for task comment mentions
        await tx.notification.createMany({
          data: mentions.map(userId => ({
            userId,
            title: 'Mentioned in Task',
            message: `You were mentioned in a comment on task: ${task?.title || 'Unknown Task'}`,
            type: 'task',
            link: task?.projectId ? `/projects/${task.projectId}?tab=board&taskId=${taskId}` : '#',
            actorId: authorId
          }))
        });
      }
      
      return tx.taskComment.findUnique({
        where: { id: comment.id },
        include: { 
          author: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
          mentions: { include: { user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } } }
        }
      });
    });
  }

  async addAttachment(taskId, userId, fileData) {
    return prisma.taskAttachment.create({
      data: {
        taskId,
        fileName: fileData.fileName,
        url: fileData.url, // In this local mock context, storing the file path
        uploadedBy: userId
      },
      include: {
        uploader: { select: { id: true, firstName: true, lastName: true, profilePicture: true } }
      }
    });
  }

  async getAttachment(attachmentId) {
    return prisma.taskAttachment.findUnique({ where: { id: attachmentId } });
  }

  async logTime(taskId, minutes) {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.isArchived) throw new NotFoundError('Task not found');
    return prisma.task.update({
      where: { id: taskId },
      data: { loggedTime: { increment: minutes } }
    });
  }
}

module.exports = new TasksService();
