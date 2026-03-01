const prisma = require('../../config/database');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const { calculateDistribution, validatePercentages } = require('../../utils/financial');

class FinanceService {
  /**
   * Record a payment against a project.
   * Distributes earnings to partner wallets atomically.
   */
  async recordPayment(projectId, amount, method, note) {
    return prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        include: {
          partners: true,
          payments: true,
          expenses: true,
        },
      });

      if (!project) throw new NotFoundError('Project not found');
      if (project.status === 'CANCELLED') throw new BadRequestError('Cannot record payment for cancelled project');

      const totalPaidBefore = project.payments.reduce((s, p) => s + Number(p.amount), 0);
      const remaining = Number(project.totalValue) - totalPaidBefore;

      if (amount > remaining + 0.01) {
        throw new BadRequestError(`Payment amount (${amount}) exceeds outstanding balance (${remaining.toFixed(2)})`);
      }

      // Create payment record
      const payment = await tx.payment.create({
        data: { projectId, amount, method: method || 'BANK_TRANSFER', note },
      });

      const totalPaidAfter = totalPaidBefore + amount;
      const totalExpenses = project.expenses.reduce((s, e) => s + Number(e.amount), 0);
      const netProfit = Number(project.totalValue) - totalExpenses;

      // Calculate distribution
      const { companyShare, partnerShares } = calculateDistribution(
        netProfit,
        Number(project.companyPercentage),
        project.partners
      );

      // Calculate how much of each partner's share is now available
      const paymentRatio = amount / Number(project.totalValue);

      for (const ps of partnerShares) {
        const earningAmount = Number(ps.amount) * paymentRatio;
        if (earningAmount <= 0) continue;

        const wallet = await tx.wallet.findUnique({ where: { userId: ps.userId } });
        if (!wallet) continue;

        const newAvailable = Number(wallet.availableBalance) + earningAmount;
        const newEarned = Number(wallet.totalEarned) + earningAmount;

        await tx.wallet.update({
          where: { userId: ps.userId },
          data: {
            availableBalance: newAvailable,
            totalEarned: newEarned,
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'EARNING',
            amount: earningAmount,
            balanceAfter: newAvailable,
            description: `Earnings from project "${project.name}" - payment of ${amount}`,
            referenceId: payment.id,
          },
        });
      }

      // Update payment status
      let paymentStatus = 'PARTIALLY_PAID';
      if (totalPaidAfter >= Number(project.totalValue) - 0.01) {
        paymentStatus = 'FULLY_PAID';
      }
      await tx.project.update({
        where: { id: projectId },
        data: { paymentStatus },
      });

      return { payment, paymentStatus, totalPaid: totalPaidAfter };
    });
  }

  /**
   * Get company financial overview
   */
  async getOverview() {
    const projects = await prisma.project.findMany({
      include: {
        payments: true,
        expenses: true,
        partners: true,
      },
    });

    let totalRevenue = 0;
    let projectExpenses = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    let companyProfitFromProjects = 0;

    for (const p of projects) {
      const value = Number(p.totalValue);
      const expenses = p.expenses.reduce((s, e) => s + Number(e.amount), 0);
      const paid = p.payments.reduce((s, pay) => s + Number(pay.amount), 0);
      const net = value - expenses;
      const compShare = net * (Number(p.companyPercentage) / 100);

      totalRevenue += value;
      projectExpenses += expenses;
      totalPaid += paid;
      totalOutstanding += value - paid;
      companyProfitFromProjects += compShare;
    }

    // Also fetch ALL expenses, including global/general ones (projectId = null)
    const allExpenses = await prisma.expense.findMany({});
    const totalExpenses = allExpenses.reduce((s, e) => s + Number(e.amount), 0);
    
    // General expenses are those not tied to a specific project
    const generalExpenses = totalExpenses - projectExpenses;

    // Company profit is the company's share of project profits, MINUS any general company expenses
    const companyProfit = companyProfitFromProjects - generalExpenses;

    const activeProjects = projects.filter((p) => p.status === 'ACTIVE').length;
    const completedProjects = projects.filter((p) => p.status === 'COMPLETED').length;

    // Get all wallets for partner earnings
    const wallets = await prisma.wallet.findMany({
      select: { totalEarned: true, totalWithdrawn: true, availableBalance: true },
    });

    const partnerEarnings = wallets.reduce((s, w) => s + Number(w.totalEarned), 0);
    const totalWithdrawn = wallets.reduce((s, w) => s + Number(w.totalWithdrawn), 0);

    // Company config
    const reserveConfig = await prisma.companyConfig.findUnique({ where: { key: 'reserve_amount' } });
    const reserveAmount = reserveConfig ? parseFloat(reserveConfig.value) : 5000;

    return {
      totalRevenue,
      totalExpenses,
      netProfit: totalRevenue - totalExpenses,
      companyProfit,
      partnerEarnings,
      totalPaid,
      totalOutstanding,
      totalWithdrawn,
      activeProjects,
      completedProjects,
      totalProjects: projects.length,
      reserveAmount,
      companyBalance: companyProfit - totalWithdrawn,
    };
  }

  /**
   * Get project financial detail
   */
  async getProjectFinance(projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        partners: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
        },
        payments: { orderBy: { paidAt: 'desc' } },
        expenses: { orderBy: { date: 'desc' } },
      },
    });

    if (!project) throw new NotFoundError('Project not found');

    const totalExpenses = project.expenses.reduce((s, e) => s + Number(e.amount), 0);
    const totalPaid = project.payments.reduce((s, p) => s + Number(p.amount), 0);
    const netProfit = Number(project.totalValue) - totalExpenses;

    const { companyShare, partnerShares } = calculateDistribution(
      netProfit,
      Number(project.companyPercentage),
      project.partners
    );

    return {
      project: {
        id: project.id,
        name: project.name,
        totalValue: project.totalValue,
        companyPercentage: project.companyPercentage,
        paymentStatus: project.paymentStatus,
      },
      financials: {
        totalValue: Number(project.totalValue),
        totalExpenses,
        netProfit,
        companyShare: Number(companyShare),
        totalPaid,
        outstanding: Number(project.totalValue) - totalPaid,
      },
      distribution: partnerShares.map((ps) => {
        const partner = project.partners.find((p) => p.userId === ps.userId);
        return {
          userId: ps.userId,
          name: partner?.user ? `${partner.user.firstName} ${partner.user.lastName}` : 'Unknown',
          percentage: Number(ps.percentage),
          totalShare: Number(ps.amount),
          paidShare: Number(ps.amount) * (totalPaid / Math.max(Number(project.totalValue), 1)),
        };
      }),
      payments: project.payments,
      expenses: project.expenses,
    };
  }
}

module.exports = new FinanceService();
