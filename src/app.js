const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const corsMiddleware = require('./config/cors');
const logger = require('./config/logger');
const { errorHandler } = require('./middleware/errorHandler');
const { generalLimiter, authLimiter, aiLimiter } = require('./middleware/rateLimiter');

// ── Route imports ─────────────────────────────────────────────────
const authRoutes = require('./modules/auth/auth.routes');
const userRoutes = require('./modules/users/user.routes');
const projectRoutes = require('./modules/projects/project.routes');
const financeRoutes = require('./modules/finance/finance.routes');
const walletRoutes = require('./modules/wallets/wallet.routes');
const withdrawalRoutes = require('./modules/withdrawals/withdrawal.routes');
const expenseRoutes = require('./modules/expenses/expense.routes');
const auditRoutes = require('./modules/audit/audit.routes');
const leadRoutes = require('./modules/crm/lead.routes');
const proposalRoutes = require('./modules/proposals/proposal.routes');
const subscriptionRoutes = require('./modules/subscriptions/subscription.routes');
const documentRoutes = require('./modules/documents/document.routes');
const knowledgeRoutes = require('./modules/knowledge/knowledge.routes');
const operationsRoutes = require('./modules/operations/operations.routes');
const chatRoutes = require('./modules/chat/chat.routes');
const notificationRoutes = require('./modules/notifications/notifications.routes');
const sprintRoutes = require('./modules/sprints/sprints.routes');
const boardColumnRoutes = require('./modules/boards/columns.routes');
const taskRoutes = require('./modules/tasks/tasks.routes');
const calendarRoutes = require('./modules/calendar/calendar.routes');
const aiRoutes = require('./modules/ai/ai.routes');
const analyticsRoutes = require('./modules/analytics/analytics.routes');
const automationRoutes = require('./modules/automations/automations.routes');
const devtrackerRoutes = require('./modules/devtracker/devtracker.routes');
const tagsRoutes = require('./modules/tags/tags.routes');
const reportRoutes = require('./modules/reports/reports.routes');
const userTasksRoutes = require('./modules/tasks/user-tasks.routes');

const app = express();

// ── Security & Parsing ───────────────────────────────────────────
app.use(helmet());
app.use(corsMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── HTTP request logging via Winston ─────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: logger.stream }));
}

// ── Global rate limiter ───────────────────────────────────────────
app.use(generalLimiter);

// ── Health check (no rate limit, no auth) ────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Auth routes (strict rate limit: brute-force protection) ──────
app.use('/api/auth', authLimiter, authRoutes);

// ── AI routes (per-user AI rate limit) ───────────────────────────
app.use('/api/ai', aiLimiter, aiRoutes);

// ── Standard API routes ───────────────────────────────────────────
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/operations', operationsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/tasks', userTasksRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/devtracker', devtrackerRoutes);

// ── Agile project children routes ─────────────────────────────────
app.use('/api/projects/:projectId/sprints', sprintRoutes);
app.use('/api/projects/:projectId/columns', boardColumnRoutes);
app.use('/api/projects/:projectId/tasks', taskRoutes);
app.use('/api/projects/:projectId/tags', tagsRoutes.projectRouter);
app.use('/api/projects/:projectId/tasks/:taskId/tags', tagsRoutes.taskRouter);

// ── 404 handler ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
