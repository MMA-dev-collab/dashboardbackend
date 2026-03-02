const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../../config/database');
const env = require('../../config/env');
const { UnauthorizedError, BadRequestError, NotFoundError } = require('../../utils/errors');

class AuthService {
  /**
   * Register a new user (admin-only operation)
   */
  async register({ email, password, firstName, lastName, roles = ['Partner'] }) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestError('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
        },
      });

      // Assign roles
      for (const roleName of roles) {
        const role = await tx.role.findUnique({ where: { name: roleName } });
        if (role) {
          await tx.userRole.create({
            data: { userId: newUser.id, roleId: role.id },
          });
        }
      }

      // Create wallet for user (Any user can be a partner and needs a wallet for earnings)
      await tx.wallet.create({
        data: { userId: newUser.id },
      });

      return newUser;
    });

    return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName };
  }

  /**
   * Login with email and password
   */
  async login(email, password) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: { include: { role: true } },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const roles = user.userRoles.map((ur) => ur.role.name);
    const accessToken = this.generateAccessToken(user.id, roles);
    const refreshToken = await this.generateRefreshToken(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePicture: user.profilePicture,
        roles,
      },
      accessToken,
      refreshToken,
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refresh(refreshToken) {
    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        user: {
          include: {
            userRoles: { include: { role: true } },
          },
        },
      },
    });

    if (!stored || stored.expiresAt < new Date()) {
      // Clean up expired token
      if (stored) {
        await prisma.refreshToken.delete({ where: { id: stored.id } });
      }
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const roles = stored.user.userRoles.map((ur) => ur.role.name);
    const accessToken = this.generateAccessToken(stored.user.id, roles);

    // Rotate refresh token
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    const newRefreshToken = await this.generateRefreshToken(stored.user.id);

    return {
      user: {
        id: stored.user.id,
        email: stored.user.email,
        firstName: stored.user.firstName,
        lastName: stored.user.lastName,
        profilePicture: stored.user.profilePicture,
        roles,
      },
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Logout - invalidate refresh token
   */
  async logout(refreshToken) {
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
  }

  /**
   * Get current user profile
   */
  async getProfile(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
        isActive: true,
        createdAt: true,
        userRoles: {
          select: { role: { select: { name: true } } },
        },
        wallet: {
          select: {
            totalEarned: true,
            pendingBalance: true,
            availableBalance: true,
            totalWithdrawn: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundError('User not found');

    return {
      ...user,
      roles: user.userRoles.map((ur) => ur.role.name),
      userRoles: undefined,
    };
  }

  generateAccessToken(userId, roles) {
    return jwt.sign({ userId, roles }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    });
  }

  async generateRefreshToken(userId) {
    const token = uuidv4() + '-' + uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: { token, userId, expiresAt },
    });

    return token;
  }
}

module.exports = new AuthService();
