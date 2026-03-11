const prisma = require('../../config/database');

class AutomationService {
  /**
   * Get all automation rules
   */
  async getRules() {
    return prisma.automationRule.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { firstName: true, lastName: true, id: true } }
      }
    });
  }

  /**
   * Create a new rule
   */
  async createRule(userId, data) {
    return prisma.automationRule.create({
      data: {
        ...data,
        createdBy: userId,
      }
    });
  }

  /**
   * Update a rule
   */
  async updateRule(id, data) {
    return prisma.automationRule.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete a rule
   */
  async deleteRule(id) {
    return prisma.automationRule.delete({
      where: { id },
    });
  }

  /**
   * Fetch logs for a specific rule
   */
  async getRuleLogs(ruleId) {
    return prisma.automationLog.findMany({
      where: { ruleId },
      orderBy: { executedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Trigger Event
   * Evaluates active rules matching the event type and executes actions
   */
  async handleTrigger(triggerEvent, payload) {
    // Find all active rules with this trigger
    const rules = await prisma.automationRule.findMany({
      where: { triggerEvent, isActive: true }
    });

    for (const rule of rules) {
      // In a real application, evaluate conditions here using payload
      // For now, assume conditions pass and execute associated actions
      let success = true;
      let errors = null;
      let actionsRun = rule.actions ? rule.actions.length : 0;
      
      try {
        // Mock action execution
        console.log(`[AUTOMATION] Executing rule ${rule.name} for event ${triggerEvent}`);
      } catch (e) {
        success = false;
        errors = e.message;
      }

      await prisma.automationLog.create({
        data: {
          ruleId: rule.id,
          triggerData: payload,
          result: { success, actionsRun, errors }
        }
      });
    }
  }
}

module.exports = new AutomationService();
