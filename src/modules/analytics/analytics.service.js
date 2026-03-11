// Analytics Service
const prisma = require('../../config/database');

class AnalyticsService {
  /**
   * Get Revenue Trends
   * Aggregates completed payments over a specified date range.
   */
  async getRevenueTrends(startDate, endDate) {
    // Generate dates if not provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); // Default 30 days

    // Get payments
    const payments = await prisma.payment.findMany({
      where: {
        paidAt: {
          gte: start,
          lte: end,
        },
      },
      select: {
        amount: true,
        paidAt: true,
      },
      orderBy: {
        paidAt: 'asc',
      },
    });

    // Group by day (simple implementation, can be improved based on requirements)
    const trends = {};
    payments.forEach(payment => {
      const dateKey = payment.paidAt.toISOString().split('T')[0];
      trends[dateKey] = (trends[dateKey] || 0) + Number(payment.amount);
    });

    return Object.keys(trends).map(date => ({
      date,
      revenue: trends[date],
    }));
  }

  /**
   * Get Project Performance
   * Gets stats on projects completion rate, active vs completed etc.
   */
  async getProjectPerformance(startDate, endDate) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); // Default 30 days

    const projects = await prisma.project.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      select: {
        status: true,
        completionPct: true,
      },
    });

    const stats = {
      total: projects.length,
      byStatus: {
        PLANNING: 0,
        ACTIVE: 0,
        ON_HOLD: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      },
      averageCompletion: 0,
    };

    let totalCompletion = 0;

    projects.forEach(project => {
      stats.byStatus[project.status] = (stats.byStatus[project.status] || 0) + 1;
      totalCompletion += project.completionPct;
    });

    if (projects.length > 0) {
      stats.averageCompletion = Math.round(totalCompletion / projects.length);
    }

    return stats;
  }

  /**
   * Get Team Workload
   * Retrieves tasks assigned to users and summarizes their workload.
   */
  async getTeamWorkload() {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        assignedTasks: {
          where: {
            isArchived: false,
            // You could filter by standard task board columns representing non-done states
            // column: { name: { not: 'Done' } } 
          },
          select: {
            id: true,
            storyPoints: true,
            column: {
              select: { name: true }
            }
          }
        }
      }
    });

    const workload = users.map(user => {
      const activeTasks = user.assignedTasks.filter(t => !['Done', 'Completed'].includes(t.column.name));
      const totalPoints = activeTasks.reduce((sum, task) => sum + task.storyPoints, 0);

      return {
        userId: user.id,
        name: `${user.firstName} ${user.lastName}`,
        activeTasksCount: activeTasks.length,
        totalStoryPoints: totalPoints,
      };
    });

    // Sort by most loaded
    return workload.sort((a, b) => b.totalStoryPoints - a.totalStoryPoints);
  }
}

module.exports = new AnalyticsService();
