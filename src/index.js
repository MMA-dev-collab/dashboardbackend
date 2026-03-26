const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/database');
const http = require('http');
const jwt = require('jsonwebtoken');

const PORT = env.PORT;

async function main() {
  // Verify database connection
  try {
    await prisma.$connect();
    console.log('✓ Database connected');
  } catch (err) {
    console.error('✗ Database connection failed:', err.message);
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  }

  // Create HTTP server from Express app
  const server = http.createServer(app);


  // Start cron jobs
  const { startCalendarCron, startAutomationCron, startDevSessionTimeoutCron } = require('./jobs/cron');
  startCalendarCron();
  startAutomationCron();
  startDevSessionTimeoutCron();

  server.listen(PORT, () => {
    console.log(`✓ EgyCodera API running on port ${PORT} [${env.NODE_ENV}]`);
    console.log(`✓ Socket.io server ready`);
    console.log(`✓ Calendar cron job active`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      await prisma.$disconnect();
      console.log('✓ Server shut down');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Forced shutdown');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
