const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding EgyCodera...');

  // 1. Create Roles
  const roles = await Promise.all([
    prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin', description: 'Full system access' } }),
    prisma.role.upsert({ where: { name: 'Partner' }, update: {}, create: { name: 'Partner', description: 'Company partner with financial access' } }),
    prisma.role.upsert({ where: { name: 'Finance Approver' }, update: {}, create: { name: 'Finance Approver', description: 'Can approve withdrawals and financial operations' } }),
    prisma.role.upsert({ where: { name: 'Viewer' }, update: {}, create: { name: 'Viewer', description: 'Read-only access to dashboards' } }),
  ]);
  console.log('  ✓ Roles created');

  // 2. Create Permissions
  const modules = ['projects', 'finance', 'wallets', 'withdrawals', 'expenses', 'crm', 'audit', 'users', 'proposals', 'documents', 'chat'];
  const actions = ['read', 'create', 'update', 'delete'];

  for (const mod of modules) {
    for (const act of actions) {
      await prisma.permission.upsert({
        where: { module_action: { module: mod, action: act } },
        update: {},
        create: { module: mod, action: act },
      });
    }
  }

  // Assign all permissions to Admin
  const allPermissions = await prisma.permission.findMany();
  const adminRole = roles.find(r => r.name === 'Admin');
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: adminRole.id, permissionId: perm.id },
    });
  }

  // Partner gets read + limited write
  const partnerRole = roles.find(r => r.name === 'Partner');
  const partnerPerms = allPermissions.filter(p =>
    p.action === 'read' || (p.module === 'projects' && p.action !== 'delete') || p.module === 'chat'
  );
  for (const perm of partnerPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: partnerRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: partnerRole.id, permissionId: perm.id },
    });
  }
  console.log('  ✓ Permissions seeded');

  // 3. Create Users
  const hashedPassword = await bcrypt.hash('EgyCodera@2024', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@egycodera.com' },
    update: {},
    create: { email: 'admin@egycodera.com', password: hashedPassword, firstName: 'System', lastName: 'Admin' },
  });

  const partner1 = await prisma.user.upsert({
    where: { email: 'ahmed@egycodera.com' },
    update: {},
    create: { email: 'ahmed@egycodera.com', password: hashedPassword, firstName: 'Ahmed', lastName: 'Hassan' },
  });

  const partner2 = await prisma.user.upsert({
    where: { email: 'omar@egycodera.com' },
    update: {},
    create: { email: 'omar@egycodera.com', password: hashedPassword, firstName: 'Omar', lastName: 'Farouk' },
  });

  const partner3 = await prisma.user.upsert({
    where: { email: 'sara@egycodera.com' },
    update: {},
    create: { email: 'sara@egycodera.com', password: hashedPassword, firstName: 'Sara', lastName: 'Nabil' },
  });
  console.log('  ✓ Users created');

  // 4. Assign Roles
  const userRoles = [
    { userId: admin.id, roleId: roles.find(r => r.name === 'Admin').id },
    { userId: partner1.id, roleId: roles.find(r => r.name === 'Partner').id },
    { userId: partner2.id, roleId: roles.find(r => r.name === 'Partner').id },
    { userId: partner3.id, roleId: roles.find(r => r.name === 'Partner').id },
    { userId: partner1.id, roleId: roles.find(r => r.name === 'Finance Approver').id },
  ];

  for (const ur of userRoles) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: ur.userId, roleId: ur.roleId } },
      update: {},
      create: ur,
    });
  }
  console.log('  ✓ Roles assigned');

  // 5. Create Wallets
  for (const u of [partner1, partner2, partner3]) {
    await prisma.wallet.upsert({
      where: { userId: u.id },
      update: {},
      create: { userId: u.id },
    });
  }
  console.log('  ✓ Wallets created');

  // 6. Create Demo Projects
  const project1 = await prisma.project.create({
    data: {
      name: 'E-Commerce Platform',
      clientName: 'TechMart',
      clientEmail: 'hello@techmart.com',
      description: 'Full-featured e-commerce platform with payment integration, inventory management, and admin dashboard.',
      status: 'ACTIVE',
      totalValue: 50000,
      companyPercentage: 30,
      paymentStatus: 'PARTIALLY_PAID',
      completionPct: 65,
      startDate: new Date('2025-01-15'),
      endDate: new Date('2025-06-30'),
    },
  });

  const project2 = await prisma.project.create({
    data: {
      name: 'Mobile Banking App',
      clientName: 'FinBank',
      clientEmail: 'projects@finbank.com',
      description: 'Secure mobile banking application with biometric auth, transfers, and statement generation.',
      status: 'PLANNING',
      totalValue: 80000,
      companyPercentage: 25,
      paymentStatus: 'NOT_PAID',
      completionPct: 10,
      startDate: new Date('2025-03-01'),
      endDate: new Date('2025-12-31'),
    },
  });
  console.log('  ✓ Projects created');

  // 7. Assign Partners
  await prisma.projectPartner.createMany({
    data: [
      { projectId: project1.id, userId: partner1.id, percentage: 40, role: 'Lead Developer' },
      { projectId: project1.id, userId: partner2.id, percentage: 35, role: 'Backend Developer' },
      { projectId: project1.id, userId: partner3.id, percentage: 25, role: 'Designer' },
      { projectId: project2.id, userId: partner1.id, percentage: 50, role: 'Lead Developer' },
      { projectId: project2.id, userId: partner2.id, percentage: 50, role: 'Backend Developer' },
    ],
  });
  console.log('  ✓ Partners assigned');

  // 8. Sample Expenses
  await prisma.expense.createMany({
    data: [
      { projectId: project1.id, userId: partner1.id, category: 'HOSTING', description: 'AWS hosting for 3 months', amount: 1500, date: new Date('2025-02-01') },
      { projectId: project1.id, userId: partner2.id, category: 'SOFTWARE', description: 'Design tool licenses', amount: 800, date: new Date('2025-01-20') },
      { userId: admin.id, category: 'OFFICE', description: 'Monthly office rent', amount: 3000, date: new Date('2025-02-01') },
    ],
  });
  console.log('  ✓ Expenses created');

  // 9. Sample Payment (for project1)
  const payment = await prisma.payment.create({
    data: {
      projectId: project1.id,
      amount: 25000,
      method: 'BANK_TRANSFER',
      note: 'First milestone payment - 50%',
    },
  });

  // Update wallets based on payment
  // Project1: value=50000, expenses=2300 (project-linked), net=47700, company=30%=14310, remaining=33390
  // Payment ratio = 25000/50000 = 0.5
  // Partner1 (40%): 33390 * 0.4 * 0.5 = 6678
  // Partner2 (35%): 33390 * 0.35 * 0.5 = 5843.25
  // Partner3 (25%): 33390 * 0.25 * 0.5 = 4173.75
  const walletAmounts = [
    { userId: partner1.id, amount: 6678 },
    { userId: partner2.id, amount: 5843.25 },
    { userId: partner3.id, amount: 4173.75 },
  ];

  for (const wa of walletAmounts) {
    const wallet = await prisma.wallet.findUnique({ where: { userId: wa.userId } });
    await prisma.wallet.update({
      where: { userId: wa.userId },
      data: { totalEarned: wa.amount, availableBalance: wa.amount },
    });
    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'EARNING',
        amount: wa.amount,
        balanceAfter: wa.amount,
        description: `Earnings from E-Commerce Platform - payment of 25000`,
        referenceId: payment.id,
      },
    });
  }
  console.log('  ✓ Payments and wallet transactions created');

  // 10. Sample Withdrawal Request
  const wallet1 = await prisma.wallet.findUnique({ where: { userId: partner1.id } });
  await prisma.withdrawalRequest.create({
    data: {
      userId: partner1.id,
      amount: 3000,
      note: 'Monthly personal withdrawal',
      status: 'PENDING',
    },
  });
  console.log('  ✓ Sample withdrawal request created');

  // 11. Sample Lead
  await prisma.lead.create({
    data: {
      companyName: 'HealthTech Solutions',
      contactName: 'Dr. Khaled Mostafa',
      email: 'khaled@healthtech.com',
      phone: '+20-100-123-4567',
      source: 'LinkedIn',
      stage: 'QUALIFIED',
      expectedValue: 35000,
      notes: 'Looking for a telemedicine platform with video consultation feature.',
      assignedTo: partner1.id,
    },
  });
  console.log('  ✓ Sample lead created');

  // 12. Milestones for project1
  await prisma.milestone.createMany({
    data: [
      { projectId: project1.id, title: 'Requirements & Design', status: 'COMPLETED', dueDate: new Date('2025-02-01') },
      { projectId: project1.id, title: 'Backend API Development', status: 'COMPLETED', dueDate: new Date('2025-03-15') },
      { projectId: project1.id, title: 'Frontend Development', status: 'IN_PROGRESS', dueDate: new Date('2025-05-01') },
      { projectId: project1.id, title: 'Testing & Launch', status: 'PENDING', dueDate: new Date('2025-06-30') },
    ],
  });
  console.log('  ✓ Milestones created');

  // 13. Company Config
  await prisma.companyConfig.upsert({
    where: { key: 'reserve_amount' },
    update: { value: '5000' },
    create: { key: 'reserve_amount', value: '5000' },
  });
  await prisma.companyConfig.upsert({
    where: { key: 'company_name' },
    update: { value: 'EgyCodera' },
    create: { key: 'company_name', value: 'EgyCodera' },
  });
  console.log('  ✓ Company config set');

  console.log('\n✅ Seed complete!');
  console.log('\n📋 Default credentials:');
  console.log('   Admin:    admin@egycodera.com / EgyCodera@2024');
  console.log('   Partner1: ahmed@egycodera.com / EgyCodera@2024');
  console.log('   Partner2: omar@egycodera.com  / EgyCodera@2024');
  console.log('   Partner3: sara@egycodera.com  / EgyCodera@2024');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
