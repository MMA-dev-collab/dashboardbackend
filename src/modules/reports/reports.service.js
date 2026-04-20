const prisma = require('../../config/database');

class ReportsService {
  async getTaskSummary(rangeDays = 30) {
    const now = new Date();
    const start = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);

    // Fetch completed tasks in range
    const completedTasks = await prisma.task.findMany({
      where: {
        isArchived: false,
        updatedAt: { gte: start },
        column: { name: { in: ['Done', 'Completed'] } },
      },
      select: {
        id: true,
        updatedAt: true,
        createdAt: true,
        assigneeId: true,
        columnId: true,
        column: { select: { name: true } },
        assignee: { select: { firstName: true, lastName: true } },
      },
    });

    // Tasks completed over time (by day)
    const completedMap = new Map();
    for (const t of completedTasks) {
      const day = t.updatedAt.toISOString().split('T')[0];
      completedMap.set(day, (completedMap.get(day) || 0) + 1);
    }
    const completedOverTime = Array.from(completedMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // Avg completion days for completed tasks
    let avgCompletionDays = 0;
    if (completedTasks.length > 0) {
      const totalDays = completedTasks.reduce((sum, t) => {
        return sum + (t.updatedAt - new Date(t.createdAt)) / (1000 * 60 * 60 * 24);
      }, 0);
      avgCompletionDays = Math.round((totalDays / completedTasks.length) * 10) / 10;
    }

    // Bottlenecks: active tasks grouped by column
    const activeTasks = await prisma.task.groupBy({
      by: ['columnId'],
      where: {
        isArchived: false,
        column: { name: { notIn: ['Done', 'Completed', 'Archived'] } },
      },
      _count: { id: true },
    });

    // For avg days stuck per column, get createdAt range
    const columnDays = await prisma.task.findMany({
      where: {
        isArchived: false,
        column: { name: { notIn: ['Done', 'Completed', 'Archived'] } },
      },
      select: { columnId: true, column: { select: { name: true } }, createdAt: true },
    });

    const columnStuck = new Map();
    for (const t of columnDays) {
      const days = (now - new Date(t.createdAt)) / (1000 * 60 * 60 * 24);
      if (!columnStuck.has(t.columnId)) {
        columnStuck.set(t.columnId, { name: t.column.name, total: 0, count: 0 });
      }
      const entry = columnStuck.get(t.columnId);
      entry.total += days;
      entry.count += 1;
    }

    const bottlenecks = activeTasks.map((g) => {
      const info = columnStuck.get(g.columnId) || { name: 'Unknown', total: 0, count: 1 };
      return {
        stage: info.name,
        tasksStuck: g._count.id,
        avgDaysStuck: info.count > 0 ? Math.round((info.total / info.count) * 10) / 10 : 0,
      };
    }).sort((a, b) => b.avgDaysStuck - a.avgDaysStuck);

    // Completed by assignee
    const assigneeMap = new Map();
    for (const t of completedTasks) {
      const key = t.assigneeId || 'unassigned';
      if (!assigneeMap.has(key)) {
        assigneeMap.set(key, { name: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : 'Unassigned', count: 0 });
      }
      assigneeMap.get(key).count += 1;
    }
    const completedByAssignee = Array.from(assigneeMap.values()).sort((a, b) => b.count - a.count);

    // Tasks created in range
    const tasksCreated = await prisma.task.count({
      where: { isArchived: false, createdAt: { gte: start } },
    });

    return {
      period: { start: start.toISOString(), end: now.toISOString() },
      tasksCompleted: completedTasks.length,
      tasksCreated,
      avgCompletionDays,
      completedOverTime,
      bottlenecks,
      completedByAssignee,
    };
  }

  async getWorkload() {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
        assignedTasks: {
          where: {
            isArchived: false,
            column: { name: { notIn: ['Done', 'Completed', 'Archived'] } },
          },
          select: {
            id: true,
            priority: true,
            dueDate: true,
            projectId: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
    });

    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    return users.map((user) => {
      const tasks = user.assignedTasks;
      const byPriority = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
      let overdueCount = 0;
      let dueThisWeek = 0;
      const byProject = new Map();

      for (const t of tasks) {
        byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
        if (t.dueDate && new Date(t.dueDate) < now) overdueCount += 1;
        if (t.dueDate && new Date(t.dueDate) <= weekEnd) dueThisWeek += 1;
        const key = t.projectId;
        if (!byProject.has(key)) {
          byProject.set(key, { projectId: key, name: t.project.name, count: 0 });
        }
        byProject.get(key).count += 1;
      }

      return {
        userId: user.id,
        name: `${user.firstName} ${user.lastName}`,
        avatar: user.profilePicture,
        totalActiveTasks: tasks.length,
        byPriority,
        overdueCount,
        dueThisWeek,
        byProject: Array.from(byProject.values()).sort((a, b) => b.count - a.count),
        activeWorkMinutes: null, // populated by getWorkloadWithDevSessions
      };
    }).sort((a, b) => b.totalActiveTasks - a.totalActiveTasks);
  }

  async getProjectComparison() {
    const projects = await prisma.project.findMany({
      where: {
        status: { not: 'CANCELLED' },
      },
      select: {
        id: true,
        name: true,
        status: true,
        completionPct: true,
        totalValue: true,
        endDate: true,
        createdAt: true,
        _count: {
          select: {
            tasks: { where: { isArchived: false } },
            partners: true,
          },
        },
      },
    });

    const now = new Date();
    const results = [];

    for (const p of projects) {
      const totalTasks = p._count.tasks;
      const completedTasks = Math.round(totalTasks * (p.completionPct / 100));

      const overdueCount = await prisma.task.count({
        where: { projectId: p.id, isArchived: false, dueDate: { lt: now } },
      });

      let velocity = 0;
      const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const recentlyDone = await prisma.task.count({
        where: {
          projectId: p.id,
          isArchived: false,
          OR: [{ updatedAt: { gte: last30 } }, { createdAt: { gte: last30 } }],
          NOT: {
            column: { name: { in: ['TODO', 'To Do', 'Backlog'] } },
          },
        },
      });
      velocity = Math.round(recentlyDone * 10) / 10;

      let daysRemaining = null;
      if (p.endDate) {
        daysRemaining = Math.ceil((p.endDate - now) / (24 * 60 * 60 * 1000));
      }

      results.push({
        projectId: p.id,
        name: p.name,
        status: p.status,
        completionPct: p.completionPct,
        totalTasks,
        completedTasks,
        overdueTasks: overdueCount,
        assigneeCount: p._count.partners,
        totalValue: Number(p.totalValue),
        deadline: p.endDate,
        daysRemaining,
        velocity,
      });
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getMyTasks(userId, status = 'ALL') {
    const now = new Date();
    const where = {
      isArchived: false,
      assigneeId: userId,
    };

    if (status !== 'ALL') {
      where.column = { name: status };
    }

    const tasks = await prisma.task.findMany({
      where,
      select: {
        id: true,
        title: true,
        type: true,
        priority: true,
        storyPoints: true,
        dueDate: true,
        createdAt: true,
        updatedAt: true,
        column: { select: { name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return tasks.map((t) => ({
      ...t,
      isOverdue: !!t.dueDate && new Date(t.dueDate) < now && !['Done', 'Completed'].includes(t.column.name),
    }));
  }

  async getActiveWorkSummary() {
    // Aggregate dev session logs by user, computing total active minutes
    // and count of sessions that pushed code
    const logs = await prisma.devSessionLog.findMany({
      select: {
        userId: true,
        startedAt: true,
        endedAt: true,
        pushedCode: true,
        requiresPull: true,
        projectId: true,
        project: { select: { id: true, name: true } },
      },
    });

    const userMap = new Map();
    for (const log of logs) {
      const uid = log.userId;
      const minutes = ((log.endedAt || new Date()) - log.startedAt) / (1000 * 60);
      if (!userMap.has(uid)) {
        userMap.set(uid, {
          userId: uid,
          totalActiveMinutes: 0,
          sessionsCompleted: 0,
          sessionsPushed: 0,
          sessionsRequiresPull: 0,
          byProject: new Map(),
        });
      }
      const entry = userMap.get(uid);
      entry.totalActiveMinutes += minutes;
      entry.sessionsCompleted += 1;
      if (log.pushedCode) entry.sessionsPushed += 1;
      if (log.requiresPull) entry.sessionsRequiresPull += 1;
      const projKey = log.projectId;
      if (!entry.byProject.has(projKey)) {
        entry.byProject.set(projKey, { projectId: projKey, name: log.project.name, minutes: 0, sessions: 0 });
      }
      entry.byProject.get(projKey).minutes += minutes;
      entry.byProject.get(projKey).sessions += 1;
    }

    // Enforce user names
    const userIds = Array.from(userMap.keys());
    if (userIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, profilePicture: true },
      });
      const nameMap = new Map(users.map(u => [u.id, { name: `${u.firstName} ${u.lastName}`, avatar: u.profilePicture }]));
      for (const [uid, entry] of userMap) {
        const info = nameMap.get(uid) || { name: 'Unknown', avatar: null };
        entry.name = info.name;
        entry.avatar = info.avatar;
      }
    }

    return Array.from(userMap.values())
      .sort((a, b) => b.totalActiveMinutes - a.totalActiveMinutes)
      .map(entry => {
        entry.totalActiveHours = Math.round(entry.totalActiveMinutes / 60 * 10) / 10;
        entry.byProject = Array.from(entry.byProject.values())
          .sort((a, b) => b.minutes - a.minutes)
          .map(p => ({ ...p, hours: Math.round(p.minutes / 60 * 10) / 10 }));
        delete entry.totalActiveMinutes;
        delete entry.byProject._map;
        return entry;
      });
  }
}

module.exports = new ReportsService();
