/**
 * Unit tests for financial calculation utilities.
 * These are pure logic tests - no database required.
 */
const {
  calculateNetProfit,
  calculateCompanyShare,
  calculateDistribution,
  validatePercentages,
  calculateAvailableFromPayment,
  checkReserve,
} = require('../../src/utils/financial');

describe('Financial Utilities', () => {
  describe('calculateNetProfit', () => {
    it('calculates net profit correctly', () => {
      const result = calculateNetProfit(50000, 10000);
      expect(Number(result)).toBe(40000);
    });

    it('handles zero expenses', () => {
      const result = calculateNetProfit(50000, 0);
      expect(Number(result)).toBe(50000);
    });

    it('handles negative profit (loss)', () => {
      const result = calculateNetProfit(10000, 15000);
      expect(Number(result)).toBe(-5000);
    });
  });

  describe('calculateCompanyShare', () => {
    it('calculates company share at 30%', () => {
      const result = calculateCompanyShare(40000, 30);
      expect(Number(result)).toBe(12000);
    });

    it('handles 0% company share', () => {
      const result = calculateCompanyShare(40000, 0);
      expect(Number(result)).toBe(0);
    });

    it('handles 100% company share', () => {
      const result = calculateCompanyShare(40000, 100);
      expect(Number(result)).toBe(40000);
    });
  });

  describe('calculateDistribution', () => {
    const partners = [
      { userId: 'user1', percentage: 40 },
      { userId: 'user2', percentage: 35 },
      { userId: 'user3', percentage: 25 },
    ];

    it('distributes partner shares correctly', () => {
      const { companyShare, partnerShares } = calculateDistribution(40000, 30, partners);
      expect(Number(companyShare)).toBe(12000);
      expect(Number(partnerShares[0].amount)).toBe(11200);  // 28000 * 0.40
      expect(Number(partnerShares[1].amount)).toBe(9800);   // 28000 * 0.35
      expect(Number(partnerShares[2].amount)).toBe(7000);   // 28000 * 0.25
    });

    it('handles zero net profit', () => {
      const { companyShare, partnerShares } = calculateDistribution(0, 30, partners);
      expect(Number(companyShare)).toBe(0);
      partnerShares.forEach(ps => expect(Number(ps.amount)).toBe(0));
    });
  });

  describe('validatePercentages', () => {
    it('validates percentages summing to 100', () => {
      const result = validatePercentages(0, [
        { percentage: 40 },
        { percentage: 35 },
        { percentage: 25 },
      ]);
      expect(result.valid).toBe(true);
      expect(Number(result.total)).toBe(100);
    });

    it('rejects percentages not summing to 100', () => {
      const result = validatePercentages(0, [
        { percentage: 40 },
        { percentage: 30 },
      ]);
      expect(result.valid).toBe(false);
      expect(Number(result.total)).toBe(70);
    });

    it('rejects empty array', () => {
      const result = validatePercentages(0, []);
      expect(result.valid).toBe(false);
    });
  });

  describe('calculateAvailableFromPayment', () => {
    it('calculates proportional availability', () => {
      const result = calculateAvailableFromPayment(10000, 25000, 50000);
      expect(Number(result)).toBe(5000); // 50% paid => 50% available
    });

    it('handles full payment', () => {
      const result = calculateAvailableFromPayment(10000, 50000, 50000);
      expect(Number(result)).toBe(10000);
    });

    it('handles zero project value', () => {
      const result = calculateAvailableFromPayment(10000, 0, 0);
      expect(Number(result)).toBe(0);
    });
  });

  describe('checkReserve', () => {
    it('allows withdrawal when reserve is maintained', () => {
      const result = checkReserve(20000, 5000, 5000);
      expect(result.allowed).toBe(true);
      expect(Number(result.availableForWithdrawal)).toBe(15000);
    });

    it('blocks withdrawal violating reserve', () => {
      const result = checkReserve(8000, 5000, 5000);
      expect(result.allowed).toBe(false);
    });

    it('allows exact reserve balance', () => {
      const result = checkReserve(10000, 5000, 5000);
      expect(result.allowed).toBe(true);
    });
  });
});
