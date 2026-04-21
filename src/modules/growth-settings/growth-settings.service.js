const prisma = require('../../config/database');
const { BadRequestError, NotFoundError } = require('../../utils/errors');
const { isValidTimezone } = require('../../config/timezone');
const dailySummaryService = require('../growth-daily-summary/growth-daily-summary.service');

class GrowthSettingsService {
  async getSettings(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        sleepTime: true,
        wakeTime: true,
        timezone: true,
        totalGamingMinutes: true,
        soloGamingMinutes: true,
        collabGamingMinutes: true,
      },
    });
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  async updateSettings(userId, data) {
    if (data.timezone && !isValidTimezone(data.timezone)) {
      throw new BadRequestError('Invalid timezone. Use IANA format (e.g., Africa/Cairo)');
    }

    if (data.totalGamingMinutes !== undefined || data.soloGamingMinutes !== undefined || data.collabGamingMinutes !== undefined) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { totalGamingMinutes: true, soloGamingMinutes: true, collabGamingMinutes: true },
      });

      const total = data.totalGamingMinutes ?? user.totalGamingMinutes;
      const solo = data.soloGamingMinutes ?? user.soloGamingMinutes;
      const collab = data.collabGamingMinutes ?? user.collabGamingMinutes;

      if (solo + collab > total) {
        throw new BadRequestError('Solo + collaborative minutes cannot exceed total gaming minutes');
      }
      if (total > 0 && solo === 0 && collab === 0) {
        throw new BadRequestError('At least one of solo or collaborative minutes must be greater than 0');
      }
      if (solo + collab !== total) {
        throw new BadRequestError('Solo + collaborative minutes must equal total gaming minutes');
      }
    }

    const updateData = {};
    if (data.sleepTime !== undefined) updateData.sleepTime = data.sleepTime;
    if (data.wakeTime !== undefined) updateData.wakeTime = data.wakeTime;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    if (data.totalGamingMinutes !== undefined) updateData.totalGamingMinutes = data.totalGamingMinutes;
    if (data.soloGamingMinutes !== undefined) updateData.soloGamingMinutes = data.soloGamingMinutes;
    if (data.collabGamingMinutes !== undefined) updateData.collabGamingMinutes = data.collabGamingMinutes;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        sleepTime: true,
        wakeTime: true,
        timezone: true,
        totalGamingMinutes: true,
        soloGamingMinutes: true,
        collabGamingMinutes: true,
      },
    });

    await dailySummaryService.recompute(userId, data.timezone || null);

    return updated;
  }
}

module.exports = new GrowthSettingsService();
