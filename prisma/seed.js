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
  where: { email: 'abdelrahman@egycodera.com' },
  update: {},
  create: { email: 'abdelrahman@egycodera.com', password: hashedPassword, firstName: 'Abdelrahman', lastName: 'Admin' },
});

const partner2 = await prisma.user.upsert({
  where: { email: 'mahmoud@egycodera.com' },
  update: {},
  create: { email: 'mahmoud@egycodera.com', password: hashedPassword, firstName: 'Mahmoud', lastName: 'Admin' },
});

const partner3 = await prisma.user.upsert({
  where: { email: 'mazen@egycodera.com' },
  update: {},
  create: { email: 'mazen@egycodera.com', password: hashedPassword, firstName: 'Mazen', lastName: 'Admin' },
});
  console.log('  ✓ Users created');

  // 4. Assign Roles

await prisma.userRole.deleteMany();

const allUsers = [admin, partner1, partner2, partner3];

for (const user of allUsers) {
  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: adminRole.id, // بنستخدم اللي متعرّف فوق
    },
  });
}

console.log('  ✓ Roles assigned');

  
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
