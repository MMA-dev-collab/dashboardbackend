/**
 * Run this script to verify your production DB has all sprint-related tables.
 * Usage: node check_production_db.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDB() {
  console.log('\n=== Production DB Diagnostic ===');
  console.log('DATABASE_URL prefix:', process.env.DATABASE_URL?.slice(0, 40) + '...');

  // 1. Check sprint tables exist
  try {
    const tables = await prisma.$queryRaw`SHOW TABLES LIKE 'sprint%'`;
    console.log('\n[OK] Sprint tables found:', tables.map(t => Object.values(t)[0]));
  } catch (e) {
    console.error('\n[FAIL] Could not query tables:', e.message);
    console.error('Prisma code:', e.code, '| Meta:', JSON.stringify(e.meta));
    return;
  }

  // 2. Try fetching sprints directly
  try {
    const count = await prisma.sprint.count();
    console.log('\n[OK] Total sprints in DB:', count);
  } catch (e) {
    console.error('\n[FAIL] prisma.sprint.count() failed:', e.message);
    console.error('  -> Code:', e.code);
    console.error('  -> This means the `sprints` table is MISSING from production DB');
  }

  // 3. Check SprintMember table
  try {
    const count = await prisma.sprintMember.count();
    console.log('[OK] Total sprint_members in DB:', count);
  } catch (e) {
    console.error('[FAIL] sprint_members table missing:', e.message);
  }

  // 4. Check SprintBudget table
  try {
    const count = await prisma.sprintBudget.count();
    console.log('[OK] Total sprint_budget rows in DB:', count);
  } catch (e) {
    console.error('[FAIL] sprint_budget table missing:', e.message);
  }

  await prisma.$disconnect();
  console.log('\n=== Done ===');
}

checkDB().catch(e => {
  console.error('Unexpected error:', e);
  prisma.$disconnect();
});
