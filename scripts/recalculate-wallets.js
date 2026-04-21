/**
 * recalculate-wallets.js
 * ─────────────────────────────────────────────────────────────────
 * One-time migration: recalculate every partner wallet using the
 * CORRECTED distribution formula.
 *
 * OLD (wrong):  partnerAmount = (netProfit - companyShare) * (pct / 100)
 * NEW (correct): partnerAmount = netProfit * (pct / 100)
 *
 * What this script does:
 *  1. Fetches all projects with their partners, payments, and expenses.
 *  2. Computes the correct earned amount per partner, per project.
 *  3. Deletes all existing EARNING wallet transactions (they were wrong).
 *  4. Resets wallet totals to the correct values while PRESERVING
 *     totalWithdrawn (approved payouts are unaffected).
 *  5. Re-inserts one corrected EARNING transaction per project/partner.
 *
 * Run once:  node scripts/recalculate-wallets.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

// ─── helpers ─────────────────────────────────────────────────────

function toD(v) {
  return new Prisma.Decimal(v ?? 0);
}

/**
 * Correct formula: each partner gets their percentage of the full net profit,
 * scaled by how much of the project has actually been paid.
 *
 *   earned = netProfit × (partnerPct / 100) × (totalPaid / totalValue)
 */
function correctPartnerEarned(netProfit, partnerPct, totalPaid, totalValue) {
  const np = toD(netProfit);
  const pct = toD(partnerPct).dividedBy(100);
  const value = toD(totalValue);

  if (value.isZero()) return toD(0);

  const paymentRatio = toD(totalPaid).dividedBy(value);
  return np.times(pct).times(paymentRatio);
}

// ─── main ─────────────────────────────────────────────────────────

async function main() {
  console.log('=== Wallet Recalculation Migration ===\n');

  // 1. Load all projects
  const projects = await prisma.project.findMany({
    include: {
      partners: true,
      payments: true,
      expenses: true,
    },
  });

  console.log(`Found ${projects.length} project(s).\n`);

  // 2. Build a map: userId → correctedTotalEarned (summed across projects)
  const earningsByUser = {}; // userId → Decimal

  for (const project of projects) {
    const totalValue = toD(project.totalValue);
    const totalExpenses = project.expenses.reduce(
      (sum, e) => sum.plus(toD(e.amount)),
      toD(0)
    );
    const netProfit = totalValue.minus(totalExpenses);
    const totalPaid = project.payments.reduce(
      (sum, p) => sum.plus(toD(p.amount)),
      toD(0)
    );

    for (const partner of project.partners) {
      const earned = correctPartnerEarned(
        netProfit,
        partner.percentage,
        totalPaid,
        totalValue
      );

      if (!earningsByUser[partner.userId]) {
        earningsByUser[partner.userId] = toD(0);
      }
      earningsByUser[partner.userId] = earningsByUser[partner.userId].plus(earned);

      console.log(
        `  Project "${project.name}" | ` +
        `User ${partner.userId} (${partner.percentage}%) | ` +
        `netProfit=${netProfit.toFixed(2)} | ` +
        `paid=${totalPaid.toFixed(2)}/${totalValue.toFixed(2)} | ` +
        `earned=${earned.toFixed(2)}`
      );
    }
  }

  console.log('\n--- Per-user totals ---');
  for (const [userId, total] of Object.entries(earningsByUser)) {
    console.log(`  ${userId}  →  totalEarned = ${total.toFixed(2)}`);
  }

  // 3. Apply corrections inside a transaction
  console.log('\nApplying corrections...');

  await prisma.$transaction(async (tx) => {
    for (const [userId, correctEarned] of Object.entries(earningsByUser)) {
      // Fetch current wallet
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        console.warn(`  ⚠  No wallet found for user ${userId} — skipping.`);
        continue;
      }

      const totalWithdrawn = toD(wallet.totalWithdrawn); // preserved as-is
      const newAvailable   = correctEarned.minus(totalWithdrawn);
      const safeAvailable  = newAvailable.isNegative() ? toD(0) : newAvailable;

      // Delete all EARNING transactions for this wallet (they were computed wrong)
      await tx.walletTransaction.deleteMany({
        where: {
          walletId: wallet.id,
          type: 'EARNING',
        },
      });

      // Update wallet with correct figures
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          totalEarned:      correctEarned,
          availableBalance: safeAvailable,
          // totalWithdrawn stays untouched — approved payouts are correct
        },
      });

      // Insert one corrected summary EARNING transaction
      await tx.walletTransaction.create({
        data: {
          walletId:    wallet.id,
          type:        'EARNING',
          amount:      correctEarned,
          balanceAfter: safeAvailable,
          description: '[Migration] Recalculated earnings — corrected distribution formula applied.',
        },
      });

      console.log(
        `  ✓  User ${userId} | ` +
        `totalEarned=${correctEarned.toFixed(2)} | ` +
        `totalWithdrawn=${totalWithdrawn.toFixed(2)} | ` +
        `availableBalance=${safeAvailable.toFixed(2)}`
      );
    }
  });

  console.log('\n✅  Migration complete.');
}

main()
  .catch((err) => {
    console.error('❌  Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
