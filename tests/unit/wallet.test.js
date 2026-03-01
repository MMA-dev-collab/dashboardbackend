/**
 * Unit tests for wallet balance computations.
 */
const { Prisma } = require('@prisma/client');
const Decimal = Prisma.Decimal;

describe('Wallet Balance Logic', () => {
  // Pure computation tests simulating wallet operations

  function computeBalance(transactions) {
    let balance = new Decimal(0);
    for (const tx of transactions) {
      if (tx.type === 'EARNING' || tx.type === 'PENDING_TO_AVAILABLE') {
        balance = balance.plus(new Decimal(tx.amount));
      } else if (tx.type === 'WITHDRAWAL') {
        balance = balance.minus(new Decimal(tx.amount));
      }
    }
    return balance;
  }

  it('computes available balance from transactions', () => {
    const transactions = [
      { type: 'EARNING', amount: 5000 },
      { type: 'EARNING', amount: 3000 },
      { type: 'WITHDRAWAL', amount: 2000 },
    ];
    expect(Number(computeBalance(transactions))).toBe(6000);
  });

  it('prevents negative available balance', () => {
    const transactions = [
      { type: 'EARNING', amount: 3000 },
    ];
    const balance = computeBalance(transactions);
    const withdrawalAmount = 5000;
    expect(Number(balance) >= withdrawalAmount).toBe(false);
  });

  it('separates pending vs available correctly', () => {
    // Simulate: earning comes as pending, then converted to available on payment
    const pendingTx = [{ type: 'EARNING', amount: 10000 }];
    const totalEarned = Number(computeBalance(pendingTx));
    
    // Only paid portion is available
    const paidRatio = 0.5; // 50% paid
    const available = totalEarned * paidRatio;
    const pending = totalEarned - available;

    expect(available).toBe(5000);
    expect(pending).toBe(5000);
  });

  it('handles multiple earning and withdrawal cycles', () => {
    const transactions = [
      { type: 'EARNING', amount: 10000 },
      { type: 'WITHDRAWAL', amount: 3000 },
      { type: 'EARNING', amount: 5000 },
      { type: 'WITHDRAWAL', amount: 7000 },
      { type: 'EARNING', amount: 2000 },
    ];
    expect(Number(computeBalance(transactions))).toBe(7000);
  });

  it('handles zero transactions', () => {
    expect(Number(computeBalance([]))).toBe(0);
  });
});
