const prisma = require('../../config/database');
const { BadRequestError, NotFoundError } = require('../../utils/errors');
const { validatePercentages } = require('../../utils/financial');

class ProjectService {
  async list(filters = {}, pagination = {}) {
    const where = {};
    if (filters.status) where.status = filters.status;
    if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search } },
        { clientName: { contains: filters.search } },
      ];
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip: pagination.skip || 0,
        take: pagination.limit || 20,
        include: {
          partners: {
            include: { user: { select: { id: true, firstName: true, lastName: true, email: true, profilePicture: true } } },
          },
          _count: { select: { expenses: true, payments: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.project.count({ where }),
    ]);

    return { projects, total };
  }

  async getById(id) {
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        partners: {
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true, profilePicture: true } } },
        },
        expenses: { orderBy: { date: 'desc' }, include: { user: { select: { firstName: true, lastName: true, profilePicture: true } } } },
        payments: { orderBy: { paidAt: 'desc' } },
        milestones: { orderBy: { createdAt: 'asc' } },
        documents: { 
          include: { uploader: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } },
          orderBy: { createdAt: 'desc' }
        }
      },
    });

    if (!project) throw new NotFoundError('Project not found');

    // Calculate financials
    const totalExpenses = project.expenses.reduce((s, e) => s + Number(e.amount), 0);
    const totalPaid = project.payments.reduce((s, p) => s + Number(p.amount), 0);
    const netProfit = Number(project.totalValue) - totalExpenses;
    const companyShare = netProfit * (Number(project.companyPercentage) / 100);

    return {
      ...project,
      financials: {
        totalExpenses,
        totalPaid,
        netProfit,
        companyShare,
        partnerPool: netProfit - companyShare,
        outstandingAmount: Number(project.totalValue) - totalPaid,
      },
    };
  }

  async create(data) {
    const { partners, ...projectData } = data;

    const projectId = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({ data: projectData });

      if (partners && partners.length > 0) {
        const { valid, total } = validatePercentages(projectData.companyPercentage, partners);
        if (!valid) {
          throw new BadRequestError(`Total ownership percentages must sum to 100% (currently ${total}%)`);
        }

        await tx.projectPartner.createMany({
          data: partners.map((p) => ({
            projectId: project.id,
            userId: p.userId,
            percentage: p.percentage,
            role: p.role || 'contributor',
          })),
        });
      }

      // Seed default Agile Board Columns
      await tx.boardColumn.createMany({
        data: [
          { projectId: project.id, name: 'TODO', order: 0 },
          { projectId: project.id, name: 'IN PROGRESS', order: 1 },
          { projectId: project.id, name: 'IN REVIEW', order: 2 },
          { projectId: project.id, name: 'DONE', order: 3 },
        ]
      });

      return project.id;
    });

    return this.getById(projectId);
  }

  async update(id, data) {
    await prisma.project.findUniqueOrThrow({ where: { id } });
    await prisma.project.update({ where: { id }, data });
    return this.getById(id);
  }

  async assignPartners(projectId, partners) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundError('Project not found');

    const { valid, total } = validatePercentages(project.companyPercentage, partners);
    if (!valid) {
      throw new BadRequestError(`Total ownership percentages must sum to 100% (currently ${total}%)`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectPartner.deleteMany({ where: { projectId } });
      await tx.projectPartner.createMany({
        data: partners.map((p) => ({
          projectId,
          userId: p.userId,
          percentage: p.percentage,
          role: p.role || 'contributor',
        })),
      });
    });

    return this.getById(projectId);
  }

  async delete(id) {
    await prisma.project.findUniqueOrThrow({ where: { id } });
    await prisma.project.delete({ where: { id } });
  }

  // Milestones
  async addMilestone(projectId, data) {
    await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    return prisma.milestone.create({
      data: { ...data, projectId },
    });
  }

  async updateMilestone(milestoneId, data) {
    return prisma.milestone.update({ where: { id: milestoneId }, data });
  }
}

module.exports = new ProjectService();
