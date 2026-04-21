const prisma = require('../../config/database');
const { NotFoundError, BadRequestError, ConflictError } = require('../../utils/errors');

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 24;
const MINUTES_PER_DAY = (DAY_END_HOUR - DAY_START_HOUR) * 60;

function toDateOnly(date) {
  const [y, m, d] = String(date).split('T')[0].split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

class GrowthScheduleService {
  async list(userId, from, to) {
    const where = { userId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = toDateOnly(from);
      if (to) where.date.lte = toDateOnly(to);
    }
    return prisma.schedule.findMany({
      where,
      include: { blocks: { orderBy: { startTime: 'asc' } } },
      orderBy: { date: 'desc' },
    });
  }

  async getByDate(userId, date) {
    const d = toDateOnly(date);

    let schedule = await prisma.schedule.findUnique({
      where: { userId_date: { userId, date: d } },
      include: { blocks: { orderBy: { startTime: 'asc' } } },
    });

    if (schedule) return schedule;

    try {
      schedule = await prisma.schedule.create({
        data: { userId, date: d },
        include: { blocks: true },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        schedule = await prisma.schedule.findUnique({
          where: { userId_date: { userId, date: d } },
          include: { blocks: { orderBy: { startTime: 'asc' } } },
        });
      } else {
        throw err;
      }
    }

    return schedule;
  }

  async createSchedule(userId, date) {
    const d = toDateOnly(date);

    return prisma.schedule.upsert({
      where: { userId_date: { userId, date: d } },
      update: {},
      create: { userId, date: d },
      include: { blocks: true },
    });
  }

  async addBlock(scheduleId, userId, data) {
    const schedule = await prisma.schedule.findFirst({ where: { id: scheduleId, userId } });
    if (!schedule) throw new NotFoundError('Schedule not found');

    const startTime = new Date(data.startTime);
    const endTime = new Date(data.endTime);
    const duration = Math.round((endTime - startTime) / 60000);

    if (duration <= 0) throw new BadRequestError('End time must be after start time');

    const conflicts = await this._findBlockConflicts(scheduleId, startTime, endTime);
    if (conflicts.length > 0) {
      throw new ConflictError(`Time conflict with: ${conflicts.map(c => c.title).join(', ')}`);
    }

    const block = await prisma.scheduleBlock.create({
      data: {
        scheduleId,
        growthTaskId: data.growthTaskId || null,
        title: data.title,
        blockType: data.blockType,
        startTime,
        endTime,
        duration,
        color: data.color,
      },
    });

    await this._recalculateScheduleTimes(scheduleId);

    return block;
  }

  async updateBlock(scheduleId, blockId, userId, data) {
    const schedule = await prisma.schedule.findFirst({ where: { id: scheduleId, userId } });
    if (!schedule) throw new NotFoundError('Schedule not found');

    const block = await prisma.scheduleBlock.findFirst({ where: { id: blockId, scheduleId } });
    if (!block) throw new NotFoundError('Block not found');

    const updateData = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.color !== undefined) updateData.color = data.color;
    if (data.status !== undefined) updateData.status = data.status;

    if (data.startTime || data.endTime) {
      const newStart = data.startTime ? new Date(data.startTime) : block.startTime;
      const newEnd = data.endTime ? new Date(data.endTime) : block.endTime;
      const newDuration = Math.round((newEnd - newStart) / 60000);

      if (newDuration <= 0) throw new BadRequestError('End time must be after start time');

      const conflicts = await this._findBlockConflicts(scheduleId, newStart, newEnd, blockId);
      if (conflicts.length > 0) {
        throw new ConflictError(`Time conflict with: ${conflicts.map(c => c.title).join(', ')}`);
      }

      updateData.startTime = newStart;
      updateData.endTime = newEnd;
      updateData.duration = newDuration;
    }

    const updated = await prisma.scheduleBlock.update({ where: { id: blockId }, data: updateData });
    await this._recalculateScheduleTimes(scheduleId);

    return updated;
  }

  async removeBlock(scheduleId, blockId, userId) {
    const schedule = await prisma.schedule.findFirst({ where: { id: scheduleId, userId } });
    if (!schedule) throw new NotFoundError('Schedule not found');

    await prisma.scheduleBlock.delete({ where: { id: blockId, scheduleId } });
    await this._recalculateScheduleTimes(scheduleId);

    return { deleted: true };
  }

  async calculateFreeTime(userId, date) {
    const d = toDateOnly(date);

    const schedule = await prisma.schedule.findUnique({
      where: { userId_date: { userId, date: d } },
      include: { blocks: true },
    });

    const scheduledMinutes = schedule
      ? schedule.blocks.reduce((sum, b) => sum + b.duration, 0)
      : 0;

    const today = toDateOnly(new Date().toISOString());
    const isToday = d.getTime() === today.getTime();

    let penalties = 0;
    let bonuses = 0;

    if (isToday) {
      const overdueCount = await prisma.growthTask.count({
        where: { userId, status: 'OVERDUE' },
      });
      const carryOverCount = await prisma.growthTask.count({
        where: { userId, isCarryOver: true, status: { in: ['PENDING', 'ACTIVE'] } },
      });
      const completedCount = await prisma.growthTask.count({
        where: { userId, status: 'COMPLETED', completedAt: { gte: today } },
      });

      penalties = (overdueCount * 15) + (carryOverCount * 10);
      bonuses = completedCount * 10;
    }

    const freeTime = Math.max(0, MINUTES_PER_DAY - scheduledMinutes - penalties + bonuses);

    if (schedule) {
      await prisma.schedule.update({
        where: { id: schedule.id },
        data: { totalFreeTime: freeTime, totalScheduledTime: scheduledMinutes },
      });
    }

    if (isToday) {
      await prisma.user.update({
        where: { id: userId },
        data: { dailyFreeTimeMinutes: freeTime },
      });
    }

    return {
      totalDayMinutes: MINUTES_PER_DAY,
      scheduledMinutes,
      penalties,
      bonuses,
      freeTime,
      penaltiesBreakdown: { overdue: Math.floor(penalties / 15) * 15, carryOver: penalties % 15 || 0 },
      bonusesBreakdown: { completedTasks: Math.floor(bonuses / 10) },
    };
  }

  async detectConflicts(userId, scheduleId) {
    const schedule = await prisma.schedule.findFirst({
      where: { id: scheduleId, userId },
      include: { blocks: { orderBy: { startTime: 'asc' } } },
    });
    if (!schedule) throw new NotFoundError('Schedule not found');

    const conflicts = [];
    const blocks = schedule.blocks;

    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        if (blocks[i].endTime > blocks[j].startTime && blocks[j].endTime > blocks[i].startTime) {
          conflicts.push({
            blockA: { id: blocks[i].id, title: blocks[i].title, startTime: blocks[i].startTime, endTime: blocks[i].endTime },
            blockB: { id: blocks[j].id, title: blocks[j].title, startTime: blocks[j].startTime, endTime: blocks[j].endTime },
            overlapMinutes: Math.round((Math.min(blocks[i].endTime, blocks[j].endTime) - Math.max(blocks[i].startTime, blocks[j].startTime)) / 60000),
          });
        }
      }
    }

    return { conflicts, conflictCount: conflicts.length };
  }

  async optimizeSchedule(userId, date) {
    const d = toDateOnly(date);

    const schedule = await this.getByDate(userId, d);
    const fixedBlocks = schedule.blocks.filter(b => b.blockType === 'FIXED_EVENT');

    const effectiveGaming = await this.getEffectiveGamingMinutes(userId, d);
    const totalGamingMinutes = effectiveGaming.gamingMinutes;

    const tasks = await prisma.growthTask.findMany({
      where: {
        userId,
        status: { in: ['PENDING', 'ACTIVE'] },
        scheduledDate: { equals: d },
      },
      orderBy: [{ priority: 'desc' }, { xpReward: 'desc' }],
    });

    const suggestions = [];
    let cursor = new Date(d);
    cursor.setHours(DAY_START_HOUR, 0, 0, 0);
    const dayEnd = new Date(d);
    dayEnd.setHours(DAY_END_HOUR, 0, 0, 0);

    const fixedIntervals = fixedBlocks.map(b => ({
      start: new Date(b.startTime),
      end: new Date(b.endTime),
    }));

    for (const task of tasks) {
      let placed = false;
      while (cursor < dayEnd && !placed) {
        const taskEnd = new Date(cursor.getTime() + task.duration * 60000);
        if (taskEnd > dayEnd) break;

        const conflictsFixed = fixedIntervals.some(
          fi => cursor < fi.end && taskEnd > fi.start
        );

        if (!conflictsFixed) {
          suggestions.push({
            growthTaskId: task.id,
            title: task.title,
            blockType: 'TASK',
            startTime: new Date(cursor),
            endTime: new Date(taskEnd),
            duration: task.duration,
            priority: task.priority,
          });
          cursor = taskEnd;
          placed = true;
        } else {
          const nextFixed = fixedIntervals
            .filter(fi => fi.start > cursor)
            .sort((a, b) => a.start - b.start)[0];
          if (nextFixed) {
            cursor = new Date(nextFixed.end.getTime() + 15 * 60000);
          } else {
            break;
          }
        }
      }
    }

    const gamingStart = cursor;
    const gamingEnd = new Date(Math.min(cursor.getTime() + totalGamingMinutes * 60000, dayEnd.getTime()));
    if (gamingEnd > gamingStart) {
      suggestions.push({
        title: 'Gaming Session',
        blockType: 'GAMING',
        startTime: gamingStart,
        endTime: gamingEnd,
        duration: Math.round((gamingEnd - gamingStart) / 60000),
      });
    }

    return { date: d, suggestions, fixedBlocks };
  }

  async setGamingTime(userId, date, { gamingMinutes, soloMinutes, collabMinutes }) {
    const schedule = await this.getByDate(userId, date);

    const updateData = {};
    if (gamingMinutes !== undefined) updateData.gamingMinutes = gamingMinutes;
    if (soloMinutes !== undefined) updateData.soloMinutes = soloMinutes;
    if (collabMinutes !== undefined) updateData.collabMinutes = collabMinutes;

    const updated = await prisma.schedule.update({
      where: { id: schedule.id },
      data: updateData,
      include: { blocks: { orderBy: { startTime: 'asc' } } },
    });

    return updated;
  }

  async getEffectiveGamingMinutes(userId, date) {
    const d = toDateOnly(date);
    const [schedule, user] = await Promise.all([
      prisma.schedule.findUnique({
        where: { userId_date: { userId, date: d } },
        select: { gamingMinutes: true, soloMinutes: true, collabMinutes: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { totalGamingMinutes: true, soloGamingMinutes: true, collabGamingMinutes: true },
      }),
    ]);

    const defaultTotal = user?.totalGamingMinutes ?? 120;
    const defaultSolo = user?.soloGamingMinutes ?? 60;
    const defaultCollab = user?.collabGamingMinutes ?? 60;

    return {
      gamingMinutes: schedule?.gamingMinutes ?? defaultTotal,
      soloMinutes: schedule?.soloMinutes ?? defaultSolo,
      collabMinutes: schedule?.collabMinutes ?? defaultCollab,
      isOverride: schedule?.gamingMinutes !== null && schedule?.gamingMinutes !== undefined,
    };
  }

  async _findBlockConflicts(scheduleId, startTime, endTime, excludeBlockId = null) {
    const where = {
      scheduleId,
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    };
    if (excludeBlockId) where.id = { not: excludeBlockId };

    return prisma.scheduleBlock.findMany({ where, select: { id: true, title: true } });
  }

  async _recalculateScheduleTimes(scheduleId) {
    const blocks = await prisma.scheduleBlock.findMany({ where: { scheduleId } });
    const totalScheduled = blocks.reduce((sum, b) => sum + b.duration, 0);
    await prisma.schedule.update({
      where: { id: scheduleId },
      data: { totalScheduledTime: totalScheduled },
    });
  }
}

module.exports = new GrowthScheduleService();
