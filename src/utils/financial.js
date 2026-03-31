const Decimal = require('@prisma/client').Prisma.Decimal;

/**
 * Financial calculation utilities.
 * All monetary operations use Decimal for precision.
 */

/**
 * Calculate net profit for a project.
 * net_profit = total_value - total_expenses
 */
function calculateNetProfit(totalValue, totalExpenses) {
  const tv = new Decimal(totalValue);
  const te = new Decimal(totalExpenses);
  return tv.minus(te);
}

/**
 * Calculate company share from net profit.
 * company_share = net_profit * (company_percentage / 100)
 */
function calculateCompanyShare(netProfit, companyPercentage) {
  const np = new Decimal(netProfit);
  const cp = new Decimal(companyPercentage).dividedBy(100);
  return np.times(cp);
}

/**
 * Calculate partner distribution.
 * remaining = net_profit - company_share
 * partner_share = remaining * (partner_percentage / 100)
 *
 * @param {Decimal|number} netProfit
 * @param {Decimal|number} companyPercentage
 * @param {Array<{userId: string, percentage: number}>} partners
 * @returns {{ companyShare: Decimal, partnerShares: Array<{userId: string, amount: Decimal}>, remaining: Decimal }}
 */
function calculateDistribution(netProfit, companyPercentage, partners) {
  const np = new Decimal(netProfit);
  const companyShare = calculateCompanyShare(np, companyPercentage);
  const remaining = np.minus(companyShare);

  const partnerShares = partners.map((p) => ({
    userId: p.userId,
    percentage: new Decimal(p.percentage),
    amount: remaining.times(new Decimal(p.percentage).dividedBy(100)),
  }));

  return { companyShare, remaining, partnerShares };
}

/**
 * Validate that company percentage + partner percentages sum to 100%.
 * @param {Decimal|number} companyPercentage
 * @param {Array<{percentage: number}>} partners
 * @returns {{ valid: boolean, total: Decimal }}
 */
function validatePercentages(companyPercentage, partners) {
  let total = new Decimal(companyPercentage || 0);
  
  if (partners && partners.length > 0) {
    total = partners.reduce(
      (sum, p) => sum.plus(new Decimal(p.percentage || 0)),
      total
    );
  }
  
  return { valid: total.equals(100), total };
}

/**
 * Calculate available amount from payment.
 * Only paid portion of project value generates available balance.
 * @param {Decimal|number} partnerShare - Total potential share
 * @param {Decimal|number} totalPaid - Total amount paid against project
 * @param {Decimal|number} totalValue - Total project value
 * @returns {Decimal} Available amount
 */
function calculateAvailableFromPayment(partnerShare, totalPaid, totalValue) {
  const share = new Decimal(partnerShare);
  const paid = new Decimal(totalPaid);
  const value = new Decimal(totalValue);

  if (value.isZero()) return new Decimal(0);

  const paidRatio = paid.dividedBy(value);
  return share.times(paidRatio);
}

/**
 * Check if withdrawal would violate company reserve.
 * @param {Decimal|number} companyBalance - Current company available balance
 * @param {Decimal|number} withdrawalAmount - Requested withdrawal
 * @param {Decimal|number} reserveAmount - Minimum reserve
 * @returns {{ allowed: boolean, availableForWithdrawal: Decimal }}
 */
function checkReserve(companyBalance, withdrawalAmount, reserveAmount) {
  const balance = new Decimal(companyBalance);
  const amount = new Decimal(withdrawalAmount);
  const reserve = new Decimal(reserveAmount);

  const afterWithdrawal = balance.minus(amount);
  return {
    allowed: afterWithdrawal.greaterThanOrEqualTo(reserve),
    availableForWithdrawal: balance.minus(reserve),
  };
}

module.exports = {
  calculateNetProfit,
  calculateCompanyShare,
  calculateDistribution,
  validatePercentages,
  calculateAvailableFromPayment,
  checkReserve,
};
