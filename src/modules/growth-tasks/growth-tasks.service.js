const prisma = require('../../config/database');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const xpService = require('../growth-xp/growth-xp.service');

const PRIORITY_XP = { LOW: 8, MEDIUM: 20, HIGH: 52 };
const CARRY_OVER_PENALTY = 10;
const COMPLETION_FREE_TIME_BONUS = 10;

class GrowthTasksService {
  async list(userId, { status, priority, date, page = 1, limit = 50 } = {}) {
    const where = { userId };
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.scheduledDate = { gte: d, lt: next };
    }

    const [tasks, total] = await Promise.all([
      prisma.growthTask.findMany({
        where,
        orderBy: [
          { isCarryOver: 'desc' },
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.growthTask.count({ where }),
    ]);

    return { data: tasks, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  async getTodayTasks(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [todaysTasks, unscheduledTasks, carryOvers] = await Promise.all([
      prisma.growthTask.findMany({
        where: { userId, scheduledDate: { gte: today, lt: tomorrow } },
        orderBy: [{ isCarryOver: 'desc' }, { priority: 'desc' }],
      }),
      prisma.growthTask.findMany({
        where: { userId, scheduledDate: null, status: { in: ['PENDING', 'ACTIVE', 'OVERDUE'] } },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.growthTask.findMany({
        where: { userId, isCarryOver: true, status: { in: ['PENDING', 'ACTIVE', 'OVERDUE'] } },
        orderBy: [{ priority: 'desc' }],
      }),
    ]);

    const allIds = new Set(todaysTasks.map(t => t.id));
    const uniqueCarryOvers = carryOvers.filter(t => !allIds.has(t.id));
    const allTasks = [...todaysTasks, ...unscheduledTasks];

    const allIdsWithUnscheduled = new Set(allTasks.map(t => t.id));
    const finalCarryOvers = uniqueCarryOvers.filter(t => !allIdsWithUnscheduled.has(t.id));

    return {
      tasks: allTasks,
      carryOvers: finalCarryOvers,
      stats: {
        total: allTasks.length + finalCarryOvers.length,
        pending: [...allTasks, ...finalCarryOvers].filter(t => t.status === 'PENDING').length,
        active: [...allTasks, ...finalCarryOvers].filter(t => t.status === 'ACTIVE').length,
        completed: [...allTasks, ...finalCarryOvers].filter(t => t.status === 'COMPLETED').length,
        overdue: [...allTasks, ...finalCarryOvers].filter(t => t.status === 'OVERDUE').length,
      },
    };
  }

  async getById(id, userId) {
    const task = await prisma.growthTask.findFirst({ where: { id, userId } });
    if (!task) throw new NotFoundError('Task not found');
    return task;
  }

  async create(userId, data) {
    const xpReward = PRIORITY_XP[data.priority] || PRIORITY_XP.MEDIUM;

    if (data.scheduledDate === '') data.scheduledDate = null;
    else if (data.scheduledDate) data.scheduledDate = new Date(data.scheduledDate);
    if (data.scheduledTime === '') data.scheduledTime = null;
    else if (data.scheduledTime) data.scheduledTime = new Date(data.scheduledTime);
    if (data.scheduledEndTime === '') data.scheduledEndTime = null;
    else if (data.scheduledEndTime) data.scheduledEndTime = new Date(data.scheduledEndTime);
    if (data.dueDate === '') data.dueDate = null;
    else if (data.dueDate) data.dueDate = new Date(data.dueDate);

    const task = await prisma.growthTask.create({
      data: { ...data, userId, xpReward },
    });

    const dateToSchedule = task.scheduledDate || new Date().toISOString().split('T')[0];
    try {
      await this._autoScheduleTask(task, userId, dateToSchedule);
    } catch (scheduleErr) {
      // Don't fail task creation if auto-scheduling fails
    }

    return task;
  }

  async update(id, userId, data) {
    const task = await this.getById(id, userId);

    if (data.scheduledDate === '') data.scheduledDate = null;
    else if (data.scheduledDate) data.scheduledDate = new Date(data.scheduledDate);
    if (data.scheduledTime === '') data.scheduledTime = null;
    else if (data.scheduledTime) data.scheduledTime = new Date(data.scheduledTime);
    if (data.scheduledEndTime === '') data.scheduledEndTime = null;
    else if (data.scheduledEndTime) data.scheduledEndTime = new Date(data.scheduledEndTime);
    if (data.dueDate === '') data.dueDate = null;
    else if (data.dueDate) data.dueDate = new Date(data.dueDate);

    if (data.priority && data.priority !== task.priority) {
      data.xpReward = PRIORITY_XP[data.priority] || PRIORITY_XP.MEDIUM;
    }

    return prisma.growthTask.update({ where: { id }, data });
  }

  async delete(id, userId) {
    const task = await this.getById(id, userId);
    return prisma.growthTask.delete({ where: { id: task.id } });
  }

  async startTask(id, userId) {
    const task = await this.getById(id, userId);
    if (task.status !== 'PENDING') throw new BadRequestError('Only pending tasks can be started');
    return prisma.growthTask.update({ where: { id }, data: { status: 'ACTIVE' } });
  }

  async completeTask(id, userId) {
    const updatedTask = await prisma.$transaction(async (tx) => {
      const task = await tx.growthTask.findFirst({ where: { id, userId } });
      if (!task) throw new NotFoundError('Task not found');
      if (task.status === 'COMPLETED') throw new BadRequestError('Task already completed');
      if (task.status !== 'ACTIVE' && task.status !== 'PENDING' && task.status !== 'OVERDUE') {
        throw new BadRequestError('Task cannot be completed in its current state');
      }

      return tx.growthTask.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }, { timeout: 10000 });

    const streakResult = await xpService.applyStreakBonus(userId);
    const multiplier = streakResult.multiplier;

    const xpResult = await xpService.grantXp(
      userId,
      updatedTask.xpReward,
      'TASK_COMPLETION',
      updatedTask.id,
      multiplier,
      `Completed task: ${updatedTask.title}`
    );

    await prisma.user.update({
      where: { id: userId },
      data: {
        dailyFreeTimeMinutes: { increment: COMPLETION_FREE_TIME_BONUS },
        gamingTimeMinutes: { increment: COMPLETION_FREE_TIME_BONUS },
      },
    });

    return { task: updatedTask, xpGranted: xpResult.granted, newLevel: xpResult.newLevel, streak: streakResult.streak };
  }

  async runCarryOver() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueTasks = await prisma.growthTask.findMany({
      where: {
        status: { in: ['PENDING', 'ACTIVE'] },
        scheduledDate: { lt: today },
      },
    });

    if (overdueTasks.length === 0) return { processed: 0 };

    const results = [];
    for (const task of overdueTasks) {
      const carried = await prisma.$transaction(async (tx) => {
        await tx.growthTask.update({
          where: { id: task.id },
          data: { status: 'OVERDUE', isCarryOver: true },
        });

        const carriedTask = await tx.growthTask.create({
          data: {
            userId: task.userId,
            title: task.title,
            description: task.description,
            duration: task.duration,
            priority: task.priority,
            xpReward: Math.floor(task.xpReward * 0.75),
            status: 'PENDING',
            taskType: task.taskType,
            isCarryOver: true,
            carryOverFrom: task.createdAt,
            scheduledDate: today,
            dueDate: null,
          },
        });

        await tx.user.update({
          where: { id: task.userId },
          data: {
            dailyFreeTimeMinutes: { decrement: CARRY_OVER_PENALTY },
            gamingTimeMinutes: { decrement: CARRY_OVER_PENALTY },
          },
        });

        return carriedTask;
      }, { timeout: 10000 });

      await xpService.grantXp(
        task.userId,
        -5,
        'PENALTY',
        task.id,
        1.0,
        `Carry-over penalty for: ${task.title}`
      );

      results.push(carried);
    }

    return { processed: results.length };
  }

  async markOverdueTasks() {
    const now = new Date();
    const result = await prisma.growthTask.updateMany({
      where: {
        status: { in: ['PENDING', 'ACTIVE'] },
        dueDate: { lt: now },
      },
      data: { status: 'OVERDUE' },
    });
    return { marked: result.count };
  }

  async _autoScheduleTask(task, userId, dateOverride) {
    const scheduleService = require('../growth-schedule/growth-schedule.service');
    const scheduleDate = dateOverride || task.scheduledDate;
    if (!scheduleDate) return;

    const schedule = await scheduleService.getByDate(userId, scheduleDate);
    if (!schedule) return;

    if (task.scheduledTime) {
      const startTime = new Date(task.scheduledTime);
      const endTime = task.scheduledEndTime 
        ? new Date(task.scheduledEndTime) 
        : new Date(startTime.getTime() + task.duration * 60000);
      await scheduleService.addBlock(schedule.id, userId, {
        growthTaskId: task.id,
        title: task.title,
        blockType: 'TASK',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        duration: task.duration,
        color: '#6c5ce7',
      });
      return;
    }

    const blocks = schedule.blocks || [];
    const sortedBlocks = blocks
      .map(b => ({ start: new Date(b.startTime).getTime(), end: new Date(b.endTime).getTime() }))
      .sort((a, b) => a.start - b.start);

    const schedDate = new Date(schedule.date);
    const dayStart = new Date(schedDate.getUTCFullYear(), schedDate.getUTCMonth(), schedDate.getUTCDate(), 6, 0, 0, 0);
    const dayEnd = new Date(schedDate.getUTCFullYear(), schedDate.getUTCMonth(), schedDate.getUTCDate(), 24, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayEnd.getTime();
    const taskDurationMs = task.duration * 60000;

    const gaps = [];
    let cursor = dayStartMs;

    for (const block of sortedBlocks) {
      if (block.start > cursor) {
        gaps.push({ start: cursor, end: block.start });
      }
      cursor = Math.max(cursor, block.end);
    }

    if (cursor < dayEndMs) {
      gaps.push({ start: cursor, end: dayEndMs });
    }

    const fittingGap = gaps.find(g => (g.end - g.start) >= taskDurationMs);

    if (fittingGap) {
      const startTime = new Date(fittingGap.start);
      const endTime = new Date(fittingGap.start + taskDurationMs);
      await scheduleService.addBlock(schedule.id, userId, {
        growthTaskId: task.id,
        title: task.title,
        blockType: 'TASK',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        duration: task.duration,
        color: '#6c5ce7',
      });
    }
  }
}

module.exports = new GrowthTasksService();
