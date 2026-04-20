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
 * All percentages (company + partners) are applied directly to the full net profit.
 * The sum of companyPercentage + all partner percentages must equal 100.
 *
 * Example:
 *   netProfit = 100,000  companyPercentage = 10
 *   partners = [{ percentage: 35 }, { percentage: 30 }, { percentage: 25 }]
 *   → companyShare  = 10,000  (10%)
 *   → partner A     = 35,000  (35%)
 *   → partner B     = 30,000  (30%)
 *   → partner C     = 25,000  (25%)
 *
 * @param {Decimal|number} netProfit
 * @param {Decimal|number} companyPercentage - Company's share as % of the full total
 * @param {Array<{userId: string, percentage: number}>} partners - Each partner's % of the full total
 * @returns {{ companyShare: Decimal, partnerShares: Array<{userId: string, percentage: Decimal, amount: Decimal}> }}
 */
function calculateDistribution(netProfit, companyPercentage, partners) {
  const np = new Decimal(netProfit);

  // Company gets its percentage of the FULL net profit
  const companyShare = calculateCompanyShare(np, companyPercentage);

  // Each partner also gets their percentage of the FULL net profit
  const partnerShares = partners.map((p) => ({
    userId: p.userId,
    percentage: new Decimal(p.percentage),
    amount: np.times(new Decimal(p.percentage).dividedBy(100)),
  }));

  return { companyShare, partnerShares };
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
