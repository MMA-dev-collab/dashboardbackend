const prisma = require('../../config/database');
const env = require('../../config/env');
const { BadRequestError, NotFoundError } = require('../../utils/errors');

class WithdrawalService {
  /**
   * Submit a withdrawal request
   */
  async submitRequest(userId, amount, note) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundError('Wallet not found');

    if (amount <= 0) throw new BadRequestError('Amount must be positive');
    if (Number(wallet.availableBalance) < amount) {
      throw new BadRequestError(
        `Insufficient available balance. Available: ${wallet.availableBalance}, Requested: ${amount}`
      );
    }

    // Check company reserve
    const reserveConfig = await prisma.companyConfig.findUnique({ where: { key: 'reserve_amount' } });
    const reserveAmount = reserveConfig ? parseFloat(reserveConfig.value) : env.COMPANY_RESERVE_AMOUNT;

    // Get total company balance
    const allWallets = await prisma.wallet.findMany({
      select: { availableBalance: true },
    });
    const totalAvailable = allWallets.reduce((s, w) => s + Number(w.availableBalance), 0);

    if (totalAvailable - amount < reserveAmount) {
      throw new BadRequestError(
        `Withdrawal would violate company reserve minimum of ${reserveAmount}. Total available: ${totalAvailable}`
      );
    }

    return prisma.$transaction(async (tx) => {
      // Re-fetch wallet in transaction
      const txWallet = await tx.wallet.findUnique({ where: { userId } });
      
      // Create request directly as APPROVED
      const request = await tx.withdrawalRequest.create({
        data: { 
          userId, 
          amount, 
          note,
          status: 'APPROVED',
          processedBy: userId, // Auto-approved by self
          processedAt: new Date()
        },
      });

      // Deduct from wallet
      const newAvailable = Number(txWallet.availableBalance) - amount;
      const newWithdrawn = Number(txWallet.totalWithdrawn) + amount;

      await tx.wallet.update({
        where: { userId },
        data: {
          availableBalance: newAvailable,
          totalWithdrawn: newWithdrawn,
        },
      });

      // Log transaction
      await tx.walletTransaction.create({
        data: {
          walletId: txWallet.id,
          type: 'WITHDRAWAL',
          amount,
          balanceAfter: newAvailable,
          description: `Withdrawal auto-approved ${note ? '- ' + note : ''}`,
          referenceId: request.id,
        },
      });

      return request;
    });
  }

  /**
   * Approve a withdrawal request (Admin/Finance Approver)
   */
  async approveRequest(requestId, processedBy) {
    return prisma.$transaction(async (tx) => {
      const request = await tx.withdrawalRequest.findUnique({
        where: { id: requestId },
      });

      if (!request) throw new NotFoundError('Withdrawal request not found');
      if (request.status !== 'PENDING') throw new BadRequestError('Request already processed');

      const wallet = await tx.wallet.findUnique({ where: { userId: request.userId } });
      if (!wallet) throw new NotFoundError('Wallet not found');

      if (Number(wallet.availableBalance) < Number(request.amount)) {
        throw new BadRequestError('Insufficient balance for this withdrawal');
      }

      // Deduct from wallet
      const newAvailable = Number(wallet.availableBalance) - Number(request.amount);
      const newWithdrawn = Number(wallet.totalWithdrawn) + Number(request.amount);

      await tx.wallet.update({
        where: { userId: request.userId },
        data: {
          availableBalance: newAvailable,
          totalWithdrawn: newWithdrawn,
        },
      });

      // Log transaction
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'WITHDRAWAL',
          amount: request.amount,
          balanceAfter: newAvailable,
          description: `Withdrawal approved - Request #${request.id.slice(0, 8)}`,
          referenceId: request.id,
        },
      });

      // Update request
      return tx.withdrawalRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          processedBy,
          processedAt: new Date(),
        },
      });
    });
  }

  /**
   * Reject a withdrawal request
   */
  async rejectRequest(requestId, processedBy, rejectReason) {
    const request = await prisma.withdrawalRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundError('Withdrawal request not found');
    if (request.status !== 'PENDING') throw new BadRequestError('Request already processed');

    return prisma.withdrawalRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        processedBy,
        processedAt: new Date(),
        rejectReason: rejectReason || 'No reason provided',
      },
    });
  }

  /**
   * List withdrawal requests
   */
  async list(filters = {}, pagination = {}) {
    const where = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.status) where.status = filters.status;

    const [requests, total] = await Promise.all([
      prisma.withdrawalRequest.findMany({
        where,
        skip: pagination.skip || 0,
        take: pagination.limit || 20,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          processor: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.withdrawalRequest.count({ where }),
    ]);

    return { requests, total };
  }
}

module.exports = new WithdrawalService();
