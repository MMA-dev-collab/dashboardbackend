const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');
const prisma = require('../../config/database');
const { success, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');

const router = Router();

// All routes require auth
router.use(authenticate);

// List users (Any authenticated user can see the directory)
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        select: {
          id: true, email: true, firstName: true, lastName: true,
          profilePicture: true, jobTitle: true,
          isActive: true, createdAt: true,
          userRoles: { select: { role: { select: { name: true } } } },
          wallet: { select: { totalEarned: true, availableBalance: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count(),
    ]);

    const mapped = users.map((u) => ({
      ...u,
      roles: u.userRoles.map((ur) => ur.role.name),
      userRoles: undefined,
    }));

    paginated(res, mapped, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// ── IMPORTANT: Static paths MUST come before /:id param routes ──

// Self-update profile (any authenticated user)
router.patch('/me/profile', async (req, res, next) => {
  try {
    const { firstName, lastName, profilePicture, jobTitle } = req.body;
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(profilePicture !== undefined && { profilePicture }),
        ...(jobTitle !== undefined && { jobTitle }),
      },
      select: { id: true, email: true, firstName: true, lastName: true, profilePicture: true, jobTitle: true },
    });
    success(res, updated, 'Profile updated');
  } catch (err) { next(err); }
});

// Get user by ID
router.get('/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        profilePicture: true, jobTitle: true,
        isActive: true, createdAt: true,
        userRoles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    success(res, { ...user, roles: user.userRoles.map((ur) => ur.role.name), userRoles: undefined });
  } catch (err) { next(err); }
});

// Update user (Admin only)
router.patch('/:id', requireRole('Admin'), async (req, res, next) => {
  try {
    const { firstName, lastName, isActive } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...(firstName && { firstName }), ...(lastName && { lastName }), ...(isActive !== undefined && { isActive }) },
      select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
    });
    success(res, user, 'User updated');
  } catch (err) { next(err); }
});

// Aggregate Profile: tasks, projects, wallet, recent notifications
router.get('/:id/profile', async (req, res, next) => {
  try {
    const userId = req.params.id;

    const [userInfo, assignedTasks, projects, wallet, recentNotifications] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          profilePicture: true, jobTitle: true,
          isActive: true, createdAt: true,
          userRoles: { select: { role: { select: { name: true } } } },
        },
      }),

      prisma.task.findMany({
        where: { assigneeId: userId, isArchived: false },
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: {
          column: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
        }
      }),

      prisma.projectPartner.findMany({
        where: { userId },
        include: {
          project: {
            select: { id: true, name: true, status: true, startDate: true, endDate: true, totalValue: true }
          }
        }
      }),

      prisma.wallet.findUnique({
        where: { userId },
        select: { totalEarned: true, totalWithdrawn: true, availableBalance: true, pendingBalance: true }
      }),

      prisma.notification.findMany({
        where: { userId },
        take: 10,
        orderBy: { createdAt: 'desc' },
      })
    ]);

    if (!userInfo) return res.status(404).json({ success: false, message: 'User not found' });

    success(res, {
      ...userInfo,
      roles: userInfo.userRoles.map(ur => ur.role.name),
      userRoles: undefined,
      assignedTasks,
      projects: projects.map(pp => pp.project),
      wallet: wallet || { totalEarned: 0, totalWithdrawn: 0, availableBalance: 0, pendingBalance: 0 },
      recentNotifications,
    });
  } catch (err) { next(err); }
});

module.exports = router;
