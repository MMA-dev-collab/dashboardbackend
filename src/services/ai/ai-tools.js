/**
 * AI Tools – RBAC-Enforced Backend Functions
 * 
 * Each tool validates permissions and returns structured JSON.
 * The AI NEVER accesses the database directly — only through these tools.
 */

const prisma = require('../../config/database');
const path = require('path');
const fs = require('fs');

// ─── Helper: truncate to ~4K chars ───
function truncate(str, maxLen = 4000) {
  if (!str || str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '\n...[truncated]';
}

// ─── Helper: Check user is partner on project ───
async function checkProjectAccess(userId, projectId) {
  const partner = await prisma.projectPartner.findFirst({
    where: { userId, projectId }
  });
  return !!partner;
}

// ─── Helper: Get user roles ───
async function getUserRoles(userId) {
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: { select: { name: true } } }
  });
  return userRoles.map(ur => ur.role.name);
}

// ════════════════════════════════════════════
// TOOL DEFINITIONS (Schema for the LLM)
// ════════════════════════════════════════════

const TOOL_DEFINITIONS = [
  {
    name: 'getMyTasks',
    description: 'Get tasks assigned to the current user. Can filter by date, project, or status.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'ISO date string to filter tasks by due date (YYYY-MM-DD). Optional.' },
        projectId: { type: 'string', description: 'Filter tasks by project ID. Optional.' },
        status: { type: 'string', description: 'Filter by column/status name. Optional.' },
        limit: { type: 'number', description: 'Max number of tasks to return. Default 20.' },
      },
      required: [],
    }
  },
  {
    name: 'getProjectDetails',
    description: 'Get full details of a specific project including budget, partners, status, milestones, and recent tasks.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID to look up.' },
        projectName: { type: 'string', description: 'Search by project name if ID is unknown. Optional.' },
      },
      required: [],
    }
  },
  {
    name: 'getProjectList',
    description: 'List all projects the current user is a partner on, with summary info.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by project status: PLANNING, ACTIVE, COMPLETED, ON_HOLD, CANCELLED. Optional.' },
      },
      required: [],
    }
  },
  {
    name: 'getWalletSummary',
    description: 'Get the current user\'s wallet: total earnings, pending, available balance, and recent transactions.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    }
  },
  {
    name: 'getCalendarEvents',
    description: 'Get calendar events, tasks with due dates, and projects for a date range.',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start of range (ISO date). Defaults to today.' },
        endDate: { type: 'string', description: 'End of range (ISO date). Defaults to 7 days from now.' },
      },
      required: [],
    }
  },
  {
    name: 'getFinanceOverview',
    description: 'Get company-wide financial overview: revenue, expenses, profit. Admin only.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    }
  },
  {
    name: 'searchDocuments',
    description: 'Search documents by name or project. Returns document list with metadata.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term to match document names.' },
        projectId: { type: 'string', description: 'Filter by project. Optional.' },
      },
      required: [],
    }
  },
  {
    name: 'getDocumentContent',
    description: 'Extract and return the text content of a specific document (PDF or DOCX). Use this when user asks about a specific document\'s contents.',
    parameters: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'The document ID to read.' },
      },
      required: ['documentId'],
    }
  },
  {
    name: 'getTeamMembers',
    description: 'List team members the current user works with across projects.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filter to a specific project. Optional.' },
      },
      required: [],
    }
  },
  {
    name: 'getNotifications',
    description: 'Get the user\'s recent notifications.',
    parameters: {
      type: 'object',
      properties: {
        unreadOnly: { type: 'boolean', description: 'Only return unread notifications. Default false.' },
        limit: { type: 'number', description: 'Max notifications to return. Default 10.' },
      },
      required: [],
    }
  },
];

// ════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ════════════════════════════════════════════

async function getMyTasks(userId, params) {
  const where = { assigneeId: userId, isArchived: false };
  if (params.projectId) where.projectId = params.projectId;
  if (params.date) {
    const d = new Date(params.date);
    where.dueDate = { gte: new Date(d.setHours(0, 0, 0, 0)), lte: new Date(d.setHours(23, 59, 59, 999)) };
  }

  const tasks = await prisma.task.findMany({
    where,
    take: params.limit || 20,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, title: true, type: true, priority: true, storyPoints: true,
      dueDate: true, createdAt: true,
      column: { select: { name: true } },
      project: { select: { id: true, name: true } },
      assignee: { select: { firstName: true, lastName: true } },
    }
  });

  return { count: tasks.length, tasks: tasks.map(t => ({
    id: t.id, title: t.title, type: t.type, priority: t.priority,
    storyPoints: t.storyPoints, dueDate: t.dueDate,
    status: t.column?.name, project: t.project?.name,
  }))};
}

async function getProjectDetails(userId, params) {
  let project;
  if (params.projectId) {
    if (!(await checkProjectAccess(userId, params.projectId))) {
      return { error: 'You do not have access to this project.' };
    }
    project = await prisma.project.findUnique({ where: { id: params.projectId }, include: projectInclude });
  } else if (params.projectName) {
    project = await prisma.project.findFirst({
      where: {
        name: { contains: params.projectName },
        partners: { some: { userId } }
      },
      include: projectInclude,
    });
  }
  if (!project) return { error: 'Project not found or access denied.' };

  return {
    id: project.id, name: project.name, client: project.clientName,
    status: project.status, description: project.description,
    totalValue: Number(project.totalValue), companyPercentage: Number(project.companyPercentage),
    paymentStatus: project.paymentStatus, completionPct: project.completionPct,
    startDate: project.startDate, endDate: project.endDate,
    partners: project.partners.map(p => ({ name: `${p.user.firstName} ${p.user.lastName}`, percentage: Number(p.percentage) })),
    expenseCount: project._count.expenses,
    paymentCount: project._count.payments,
    taskCount: project._count.tasks,
    documentCount: project._count.documents,
  };
}

const projectInclude = {
  partners: { include: { user: { select: { firstName: true, lastName: true } } } },
  _count: { select: { expenses: true, payments: true, tasks: true, documents: true } },
};

async function getProjectList(userId, params) {
  const where = { partners: { some: { userId } } };
  if (params.status) where.status = params.status;

  const projects = await prisma.project.findMany({
    where,
    select: {
      id: true, name: true, clientName: true, status: true,
      totalValue: true, paymentStatus: true, completionPct: true,
      startDate: true, endDate: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  return { count: projects.length, projects: projects.map(p => ({
    id: p.id, name: p.name, client: p.clientName, status: p.status,
    totalValue: Number(p.totalValue), paymentStatus: p.paymentStatus,
    completion: p.completionPct + '%',
  }))};
}

async function getWalletSummary(userId) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: {
      totalEarnings: true, pendingEarnings: true,
      availableBalance: true, totalWithdrawn: true,
    }
  });
  if (!wallet) return { error: 'No wallet found.' };
  return {
    totalEarnings: Number(wallet.totalEarnings),
    pendingEarnings: Number(wallet.pendingEarnings),
    availableBalance: Number(wallet.availableBalance),
    totalWithdrawn: Number(wallet.totalWithdrawn),
  };
}

async function getCalendarEvents(userId, params) {
  const start = params.startDate ? new Date(params.startDate) : new Date();
  const end = params.endDate ? new Date(params.endDate) : new Date(Date.now() + 7 * 86400000);

  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: { assigneeId: userId, isArchived: false, dueDate: { gte: start, lte: end } },
      select: { id: true, title: true, dueDate: true, priority: true, project: { select: { name: true } } },
      take: 30,
    }),
    prisma.event.findMany({
      where: { OR: [{ attendees: { some: { userId } } }, { createdBy: userId }], startDate: { lte: end }, endDate: { gte: start } },
      select: { id: true, title: true, startDate: true, endDate: true, type: true, allDay: true },
      take: 30,
    }),
  ]);

  return {
    tasksDue: tasks.map(t => ({ title: t.title, dueDate: t.dueDate, priority: t.priority, project: t.project?.name })),
    events: events.map(e => ({ title: e.title, start: e.startDate, end: e.endDate, type: e.type })),
  };
}

async function getFinanceOverview(userId) {
  const roles = await getUserRoles(userId);
  if (!roles.includes('Admin') && !roles.includes('Finance Approver')) {
    return { error: 'Access denied. Admin or Finance Approver role required.' };
  }

  const projects = await prisma.project.findMany({
    select: { totalValue: true, status: true, companyPercentage: true },
  });

  const totalRevenue = projects.reduce((s, p) => s + Number(p.totalValue), 0);
  const activeCount = projects.filter(p => p.status === 'ACTIVE').length;
  const expenses = await prisma.expense.aggregate({ _sum: { amount: true } });

  return {
    totalRevenue,
    totalExpenses: Number(expenses._sum.amount || 0),
    netProfit: totalRevenue - Number(expenses._sum.amount || 0),
    activeProjectsCount: activeCount,
    totalProjects: projects.length,
  };
}

async function searchDocuments(userId, params) {
  const userProjects = await prisma.projectPartner.findMany({
    where: { userId },
    select: { projectId: true },
  });
  const projectIds = userProjects.map(p => p.projectId);

  const where = { projectId: { in: projectIds } };
  if (params.query) where.fileName = { contains: params.query };
  if (params.projectId) {
    if (!projectIds.includes(params.projectId)) return { error: 'Access denied.' };
    where.projectId = params.projectId;
  }

  const docs = await prisma.document.findMany({
    where,
    select: { id: true, fileName: true, mimeType: true, createdAt: true, project: { select: { name: true } } },
    take: 20,
    orderBy: { createdAt: 'desc' },
  });

  return { count: docs.length, documents: docs.map(d => ({
    id: d.id, name: d.fileName, type: d.mimeType, project: d.project?.name, uploadedAt: d.createdAt,
  }))};
}

async function getDocumentContent(userId, params) {
  const doc = await prisma.document.findUnique({
    where: { id: params.documentId },
    select: { id: true, fileName: true, filePath: true, mimeType: true, projectId: true },
  });
  if (!doc) return { error: 'Document not found.' };

  // RBAC: check project access
  if (doc.projectId && !(await checkProjectAccess(userId, doc.projectId))) {
    return { error: 'Access denied to this document.' };
  }

  // Extract text based on file type
  const ext = path.extname(doc.fileName || doc.filePath || '').toLowerCase();
  let text = '';

  try {
    const filePath = path.resolve(doc.filePath);
    if (!fs.existsSync(filePath)) return { error: 'File not found on disk.' };
    const buffer = fs.readFileSync(filePath);

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const pdfData = await pdfParse(buffer);
      text = pdfData.text;
    } else if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (['.txt', '.md', '.csv', '.json'].includes(ext)) {
      text = buffer.toString('utf-8');
    } else {
      return { documentName: doc.fileName, error: `Cannot extract text from ${ext} files.` };
    }
  } catch (err) {
    return { documentName: doc.fileName, error: `Failed to read file: ${err.message}` };
  }

  return { documentName: doc.fileName, type: ext, content: truncate(text) };
}

async function getTeamMembers(userId, params) {
  const where = { userId };
  if (params.projectId) where.projectId = params.projectId;

  const myProjects = await prisma.projectPartner.findMany({
    where,
    select: { projectId: true },
  });
  const projectIds = myProjects.map(p => p.projectId);

  const partners = await prisma.projectPartner.findMany({
    where: { projectId: { in: projectIds } },
    select: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true } },
      project: { select: { name: true } },
    },
  });

  // Deduplicate by user ID
  const seen = new Set();
  const members = [];
  for (const p of partners) {
    if (!seen.has(p.user.id)) {
      seen.add(p.user.id);
      members.push({ ...p.user, projects: partners.filter(x => x.user.id === p.user.id).map(x => x.project.name) });
    }
  }

  return { count: members.length, members };
}

async function getNotifications(userId, params) {
  const where = { userId };
  if (params.unreadOnly) where.isRead = false;

  const notifs = await prisma.notification.findMany({
    where,
    take: params.limit || 10,
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, message: true, type: true, isRead: true, createdAt: true },
  });

  return { count: notifs.length, notifications: notifs };
}

// ═══ Export ═══

module.exports = {
  TOOL_DEFINITIONS,
  TOOL_IMPLEMENTATIONS: {
    getMyTasks,
    getProjectDetails,
    getProjectList,
    getWalletSummary,
    getCalendarEvents,
    getFinanceOverview,
    searchDocuments,
    getDocumentContent,
    getTeamMembers,
    getNotifications,
  },
};
