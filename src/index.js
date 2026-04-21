const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/database');
const logger = require('./config/logger');
const { closeAllClients } = require('./utils/notify');
const http = require('http');

const PORT = env.PORT;

async function main() {
  // ── Verify database connection ────────────────────────────────
  try {
    await prisma.$connect();
    logger.info('✓ Database connected');
  } catch (err) {
    logger.error('✗ Database connection failed', { error: err.message });
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  }

  // ── Create HTTP server ─────────────────────────────────────────
  const server = http.createServer(app);

  // ── Start cron jobs ────────────────────────────────────────────
  const {
    startCalendarCron,
    startAutomationCron,
    startDevSessionTimeoutCron,
    startGrowthCronJobs,
  } = require('./jobs/cron');
  startCalendarCron();
  startAutomationCron();
  startDevSessionTimeoutCron();
  startGrowthCronJobs();

  // ── Start listening ────────────────────────────────────────────
  server.listen(PORT, () => {
    logger.info(`✓ EgyCodera API running on port ${PORT} [${env.NODE_ENV}]`);
    logger.info('✓ Calendar cron job active');
  });

  // ── Graceful shutdown ─────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully...`);

    // Close all open SSE connections first
    closeAllClients();

    server.close(async () => {
      await prisma.$disconnect();
      logger.info('✓ Server shut down cleanly');
      process.exit(0);
    });

    // Force exit after 10 s if something hangs
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ── Unhandled rejection safety net ────────────────────────────
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection', { reason: String(reason) });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception — shutting down', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

main();
