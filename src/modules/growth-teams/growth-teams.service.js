const prisma = require('../../config/database');
const { NotFoundError, BadRequestError, ConflictError, ForbiddenError } = require('../../utils/errors');

class GrowthTeamsService {
  async listTeams(userId) {
    const memberships = await prisma.growthTeamMember.findMany({
      where: { userId },
      include: {
        team: {
          include: {
            members: { include: { user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } } },
            _count: { select: { members: true } },
          },
        },
      },
    });
    return memberships.map(m => ({
      ...m.team,
      role: m.role,
      memberCount: m.team._count?.members || m.team.members.length,
    }));
  }

  async createTeam(userId, data) {
    return prisma.$transaction(async (tx) => {
      const team = await tx.growthTeam.create({
        data: { name: data.name, description: data.description, createdBy: userId },
      });
      await tx.growthTeamMember.create({
        data: { teamId: team.id, userId, role: 'leader' },
      });
      return tx.growthTeam.findUnique({
        where: { id: team.id },
        include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } } } },
      });
    });
  }

  async getTeamDetail(teamId, userId) {
    const membership = await prisma.growthTeamMember.findFirst({ where: { teamId, userId } });
    if (!membership) throw new ForbiddenError('You are not a member of this team');

    return prisma.growthTeam.findUnique({
      where: { id: teamId },
      include: {
        members: { include: { user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } } },
        invites: { where: { status: 'PENDING' }, include: { invitee: { select: { id: true, firstName: true, lastName: true } } } },
        gamingSessions: { where: { status: { in: ['SCHEDULED', 'ACTIVE'] } } },
      },
    });
  }

  async updateTeam(teamId, userId, data) {
    const membership = await prisma.growthTeamMember.findFirst({ where: { teamId, userId, role: 'leader' } });
    if (!membership) throw new ForbiddenError('Only the team leader can update the team');

    return prisma.growthTeam.update({ where: { id: teamId }, data });
  }

  async leaveTeam(teamId, userId) {
    return prisma.$transaction(async (tx) => {
      const membership = await tx.growthTeamMember.findFirst({ where: { teamId, userId } });
      if (!membership) throw new NotFoundError('Not a member of this team');

      await tx.growthTeamMember.delete({ where: { id: membership.id } });

      const remaining = await tx.growthTeamMember.count({ where: { teamId } });
      if (remaining === 0) {
        await tx.growthTeam.delete({ where: { id: teamId } });
        return { left: true, teamDeleted: true };
      }

      if (membership.role === 'leader') {
        const firstMember = await tx.growthTeamMember.findFirst({ where: { teamId } });
        if (firstMember) {
          await tx.growthTeamMember.update({ where: { id: firstMember.id }, data: { role: 'leader' } });
        }
      }

      return { left: true, teamDeleted: false };
    });
  }

  async addMember(teamId, inviterId, data) {
    const membership = await prisma.growthTeamMember.findFirst({ where: { teamId, userId: inviterId, role: 'leader' } });
    if (!membership) throw new ForbiddenError('Only the team leader can add members');

    const existing = await prisma.growthTeamMember.findFirst({ where: { teamId, userId: data.userId } });
    if (existing) throw new ConflictError('User is already a member');

    return prisma.$transaction(async (tx) => {
      const member = await tx.growthTeamMember.create({
        data: { teamId, userId: data.userId, role: data.role || 'member' },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      });

      await tx.growthInvite.create({
        data: { teamId, inviterId, inviteeId: data.userId, type: 'TEAM', status: 'ACCEPTED', message: 'Added to team' },
      });

      await tx.notification.create({
        data: {
          userId: data.userId,
          title: 'Added to Team',
          message: `You were added to a team.`,
          type: 'info',
          link: `/growth/teams`,
          actorId: inviterId,
        },
      });

      return member;
    });
  }

  async removeMember(teamId, leaderId, memberUserId) {
    const membership = await prisma.growthTeamMember.findFirst({ where: { teamId, userId: leaderId, role: 'leader' } });
    if (!membership) throw new ForbiddenError('Only the team leader can remove members');
    if (leaderId === memberUserId) throw new BadRequestError('Use leave team to remove yourself');

    const target = await prisma.growthTeamMember.findFirst({ where: { teamId, userId: memberUserId } });
    if (!target) throw new NotFoundError('Member not found');

    return prisma.growthTeamMember.delete({ where: { id: target.id } });
  }

  async listAvailableUsers(userId) {
    const [friendships, sentRequests] = await Promise.all([
      prisma.friendship.findMany({
        where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
        select: { requesterId: true, addresseeId: true, status: true },
      }),
      prisma.growthTeamMember.findMany({
        where: { userId },
        select: { teamId: true },
      }),
    ]);

    const excludeIds = new Set([userId]);
    friendships.forEach(f => {
      excludeIds.add(f.requesterId);
      excludeIds.add(f.addresseeId);
    });

    const users = await prisma.user.findMany({
      where: { id: { notIn: [...excludeIds] }, isActive: true },
      select: { id: true, firstName: true, lastName: true, profilePicture: true },
      take: 100,
      orderBy: { firstName: 'asc' },
    });

    return users;
  }

  async listFriends(userId) {
    const friendships = await prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
        addressee: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
      },
    });

    return friendships.map(f => {
      const friend = f.requesterId === userId ? f.addressee : f.requester;
      return { friendshipId: f.id, ...friend };
    });
  }

  async sendFriendRequest(requesterId, addresseeId) {
    if (requesterId === addresseeId) throw new BadRequestError('Cannot send friend request to yourself');

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
      },
    });
    if (existing) throw new ConflictError('Friend request already exists or users are already friends');

    return prisma.$transaction(async (tx) => {
      const friendship = await tx.friendship.create({
        data: { requesterId, addresseeId, status: 'PENDING' },
      });

      await tx.notification.create({
        data: {
          userId: addresseeId,
          title: 'Friend Request',
          message: 'You have a new friend request.',
          type: 'info',
          link: '/growth/teams',
          actorId: requesterId,
        },
      });

      return friendship;
    });
  }

  async respondToFriendRequest(friendshipId, userId, status) {
    return prisma.$transaction(async (tx) => {
      const friendship = await tx.friendship.findUnique({ where: { id: friendshipId } });
      if (!friendship) throw new NotFoundError('Friend request not found');
      if (friendship.addresseeId !== userId) throw new ForbiddenError('Not your friend request');
      if (friendship.status !== 'PENDING') throw new BadRequestError('Request already responded to');

      const updated = await tx.friendship.update({
        where: { id: friendshipId },
        data: { status },
      });

      if (status === 'ACCEPTED') {
        await tx.notification.create({
          data: {
            userId: friendship.requesterId,
            title: 'Friend Request Accepted',
            message: 'Your friend request was accepted!',
            type: 'success',
            link: '/growth/teams',
            actorId: userId,
          },
        });
      }

      return updated;
    });
  }

  async removeFriend(friendshipId, userId) {
    const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!friendship) throw new NotFoundError('Friendship not found');
    if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
      throw new ForbiddenError('Not your friendship');
    }
    return prisma.friendship.delete({ where: { id: friendshipId } });
  }

  async getAvailability(userId) {
    return prisma.availabilitySlot.findMany({
      where: { userId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async setAvailability(userId, slots) {
    return prisma.$transaction(async (tx) => {
      await tx.availabilitySlot.deleteMany({ where: { userId } });

      const created = await tx.availabilitySlot.createMany({
        data: slots.map(s => ({
          userId,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          isRecurring: s.isRecurring !== false,
          specificDate: s.specificDate ? new Date(s.specificDate) : null,
        })),
      });

      return { slotsCreated: created.count };
    });
  }

  async detectOverlap(userIds) {
    const allSlots = await prisma.availabilitySlot.findMany({
      where: { userId: { in: userIds } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });

    const overlaps = [];

    for (let day = 0; day <= 6; day++) {
      const daySlots = allSlots.filter(s => s.dayOfWeek === day);
      const byUser = {};
      for (const slot of daySlots) {
        if (!byUser[slot.userId]) byUser[slot.userId] = [];
        byUser[slot.userId].push(slot);
      }

      const usersWithSlots = Object.keys(byUser);
      if (usersWithSlots.length < 2) continue;

      const userArrays = usersWithSlots.map(uid => byUser[uid]);
      for (let i = 0; i < userArrays.length; i++) {
        for (let j = i + 1; j < userArrays.length; j++) {
          for (const slotA of userArrays[i]) {
            for (const slotB of userArrays[j]) {
              const overlapStart = slotA.startTime > slotB.startTime ? slotA.startTime : slotB.startTime;
              const overlapEnd = slotA.endTime < slotB.endTime ? slotA.endTime : slotB.endTime;

              if (overlapStart < overlapEnd) {
                const [oh, om] = overlapStart.split(':').map(Number);
                const [eh, em] = overlapEnd.split(':').map(Number);
                const durationMinutes = (eh * 60 + em) - (oh * 60 + om);

                overlaps.push({
                  dayOfWeek: day,
                  startTime: overlapStart,
                  endTime: overlapEnd,
                  durationMinutes,
                  users: [slotA.user, slotB.user],
                });
              }
            }
          }
        }
      }
    }

    overlaps.sort((a, b) => b.durationMinutes - a.durationMinutes);
    return overlaps;
  }

  async listInvites(userId) {
    return prisma.growthInvite.findMany({
      where: { inviteeId: userId, status: 'PENDING' },
      include: {
        team: { select: { id: true, name: true } },
        inviter: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async respondToInvite(inviteId, userId, status) {
    return prisma.$transaction(async (tx) => {
      const invite = await tx.growthInvite.findUnique({ where: { id: inviteId } });
      if (!invite) throw new NotFoundError('Invite not found');
      if (invite.inviteeId !== userId) throw new ForbiddenError('Not your invite');
      if (invite.status !== 'PENDING') throw new BadRequestError('Invite already responded to');

      const updated = await tx.growthInvite.update({
        where: { id: inviteId },
        data: { status },
      });

      if (status === 'ACCEPTED' && invite.type === 'TEAM' && invite.teamId) {
        const existing = await tx.growthTeamMember.findFirst({
          where: { teamId: invite.teamId, userId },
        });
        if (!existing) {
          await tx.growthTeamMember.create({
            data: { teamId: invite.teamId, userId, role: 'member' },
          });
        }
      }

      if (status === 'ACCEPTED') {
        await tx.notification.create({
          data: {
            userId: invite.inviterId,
            title: 'Invite Accepted',
            message: `Your invite was accepted!`,
            type: 'success',
            link: '/growth/teams',
            actorId: userId,
          },
        });
      }

      return updated;
    });
  }
}

module.exports = new GrowthTeamsService();
