const { PrismaClient } = require('@prisma/client');

// Reusable Prisma client instance to prevent connection leaks in serverless/dev
const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error', 'warn'],
  });
};

if (!global.__prisma) {
  global.__prisma = prismaClientSingleton();
}

const prisma = global.__prisma;

module.exports = prisma;
