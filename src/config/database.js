const { PrismaClient } = require('@prisma/client');

const datasourceUrl = process.env.DATABASE_URL;

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    log: ['error', 'warn'],
    datasourceUrl,
  });
} else {
  // Reuse client in development to avoid too many connections
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ['query', 'error', 'warn'],
      datasourceUrl,
    });
  }
  prisma = global.__prisma;
}

module.exports = prisma;
