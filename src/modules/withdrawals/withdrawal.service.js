const prisma = require('../../config/database');
const env = require('../../config/env');
const { BadRequestError, NotFoundError } = require('../../utils/errors');
const { sendNotification, getAdminUserIds } = require('../../utils/notify');

class WithdrawalService {
  /**
   * Submit a withdrawal request.
   * Creates a PENDING request — does NOT deduct from wallet.
   * Notifies all OTHER admins that a withdrawal needs review.
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

    // Create request as PENDING — wallet is NOT touched yet
    const request = await prisma.withdrawalRequest.create({
      data: {
        userId,
        amount,
        note,
        status: 'PENDING',
      },
    });

    // Get the requester's name for the notification
    const requester = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const requesterName = requester ? `${requester.firstName} ${requester.lastName}` : 'A team member';
    const fmtAmount = `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    // Notify all OTHER admins about the pending withdrawal
    const adminIds = await getAdminUserIds(userId);
    for (const adminId of adminIds) {
      await sendNotification({
        userId: adminId,
        title: 'Withdrawal Request Pending',
        message: `${requesterName} has requested a withdrawal of ${fmtAmount}. Please review and approve or reject.`,
        type: 'withdrawal',
        link: '/withdrawals',
        actorId: userId,
      });
    }

    return request;
  }

  /**
   * Get a single withdrawal request by ID
   */
  async getRequestById(id) {
    const request = await prisma.withdrawalRequest.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!request) throw new NotFoundError('Withdrawal request not found');
    return request;
  }

  /**
   * Approve a withdrawal request (Admin/Finance Approver).
   * An admin CANNOT approve their own withdrawal — must be another admin.
   * This is where the wallet deduction happens.
   * Notifies the requester AND other admins about the approval.
   */
  async approveRequest(requestId, processedBy, receiptFile, verifiedAmount, transactionId) {
    const result = await prisma.$transaction(async (tx) => {
      // Use locking if available, but for now standard findUnique
      const request = await tx.withdrawalRequest.findUnique({
        where: { id: requestId },
      });

      if (!request) throw new NotFoundError('Withdrawal request not found');
      
      // Immutability Check: Ensure the request is still PENDING
      if (request.status !== 'PENDING') {
        throw new BadRequestError('Request already processed. Receipts cannot be added to finalized requests.');
      }

      // Prevent self-approval
      if (request.userId === processedBy) {
        throw new BadRequestError('You cannot approve your own withdrawal request. Another admin must process it.');
      }

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

      // Update request with receipt details and verification data
      const updated = await tx.withdrawalRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          processedBy,
          processedAt: new Date(),
          receiptPath: receiptFile.path,
          receiptFileName: receiptFile.originalname,
          receiptMimeType: receiptFile.mimetype,
          verifiedAmount: verifiedAmount || null,
          transactionId: transactionId || null,
        },
      });

      return updated;
    });

    // Send notifications AFTER the transaction succeeds
    const [approver, requester] = await Promise.all([
      prisma.user.findUnique({ where: { id: processedBy }, select: { firstName: true, lastName: true } }),
      prisma.user.findUnique({ where: { id: result.userId }, select: { firstName: true, lastName: true } }),
    ]);
    const approverName = approver ? `${approver.firstName} ${approver.lastName}` : 'An admin';
    const requesterName = requester ? `${requester.firstName} ${requester.lastName}` : 'A team member';
    const fmtAmount = `$${Number(result.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    // Notify the requester that their withdrawal was approved, including receipt link
    await sendNotification({
      userId: result.userId,
      title: 'Withdrawal Approved ✅',
      message: `Your withdrawal of ${fmtAmount} has been approved by ${approverName}. The funds have been deducted from your wallet. You can download the transfer receipt from the payout page.`,
      type: 'withdrawal',
      link: '/withdrawals', // This directs them to the page where they can see & download the receipt
      actorId: processedBy,
    });

    // Notify other admins (excluding the requester and the approver)
    const adminIds = await getAdminUserIds();
    for (const adminId of adminIds) {
      if (adminId !== processedBy && adminId !== result.userId) {
        await sendNotification({
          userId: adminId,
          title: 'Withdrawal Approved',
          message: `${approverName} approved ${requesterName}'s withdrawal of ${fmtAmount}.`,
          type: 'withdrawal',
          link: '/withdrawals',
          actorId: processedBy,
        });
      }
    }

    return result;
  }

  /**
   * Reject a withdrawal request.
   * An admin CANNOT reject their own withdrawal.
   * No wallet impact since PENDING requests don't touch the wallet.
   * Notifies the requester AND other admins about the rejection.
   */
  async rejectRequest(requestId, processedBy, rejectReason) {
    const request = await prisma.withdrawalRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundError('Withdrawal request not found');
    if (request.status !== 'PENDING') throw new BadRequestError('Request already processed');

    // Prevent self-rejection
    if (request.userId === processedBy) {
      throw new BadRequestError('You cannot reject your own withdrawal request. Another admin must process it.');
    }

    const result = await prisma.withdrawalRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        processedBy,
        processedAt: new Date(),
        rejectReason: rejectReason || 'No reason provided',
      },
    });

    // Send notifications
    const [rejector, requester] = await Promise.all([
      prisma.user.findUnique({ where: { id: processedBy }, select: { firstName: true, lastName: true } }),
      prisma.user.findUnique({ where: { id: result.userId }, select: { firstName: true, lastName: true } }),
    ]);
    const rejectorName = rejector ? `${rejector.firstName} ${rejector.lastName}` : 'An admin';
    const requesterName = requester ? `${requester.firstName} ${requester.lastName}` : 'A team member';
    const fmtAmount = `$${Number(result.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const reason = rejectReason ? ` Reason: ${rejectReason}` : '';

    // Notify the requester that their withdrawal was rejected
    await sendNotification({
      userId: result.userId,
      title: 'Withdrawal Rejected ❌',
      message: `Your withdrawal of ${fmtAmount} has been rejected by ${rejectorName}.${reason}`,
      type: 'withdrawal',
      link: '/withdrawals',
      actorId: processedBy,
    });

    // Notify other admins (excluding the requester and the rejector)
    const adminIds = await getAdminUserIds();
    for (const adminId of adminIds) {
      if (adminId !== processedBy && adminId !== result.userId) {
        await sendNotification({
          userId: adminId,
          title: 'Withdrawal Rejected',
          message: `${rejectorName} rejected ${requesterName}'s withdrawal of ${fmtAmount}.${reason}`,
          type: 'withdrawal',
          link: '/withdrawals',
          actorId: processedBy,
        });
      }
    }

    return result;
  }

  /**
   * Delete a withdrawal request.
   * Only the requester can delete their own request.
   * Can only delete if status is PENDING or REJECTED (not APPROVED).
   * No wallet impact since PENDING/REJECTED never touched the wallet.
   */
  async deleteRequest(requestId, userId) {
    const request = await prisma.withdrawalRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundError('Withdrawal request not found');

    // Only the owner can delete their own request
    if (request.userId !== userId) {
      throw new BadRequestError('You can only delete your own withdrawal requests.');
    }

    // Cannot delete approved withdrawals (money already moved)
    if (request.status === 'APPROVED') {
      throw new BadRequestError('Cannot delete an approved withdrawal. The funds have already been processed.');
    }

    await prisma.withdrawalRequest.delete({ where: { id: requestId } });
    return { message: 'Withdrawal request deleted successfully' };
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
