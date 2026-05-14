// Script to create initial admin user
// Run: node scripts/create-admin.js

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const connectionString = process.env.DATABASE_URL || "postgresql://app_backend:admin@localhost:5432/bealpha_db?schema=public";

async function main() {
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log("Starting admin user creation...\n");

    // 1. Create Label: beAlpha
    console.log("Creating label: beAlpha...");
    const label = await prisma.label.upsert({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000001",
        name: "beAlpha",
        description: "beAlpha Music Label",
      },
    });
    console.log(`Label created: ${label.name} (${label.id})`);

    // 2. Create Artist: Rimi
    console.log("Creating artist: Rimi...");
    const artist = await prisma.artist.upsert({
      where: { id: "00000000-0000-0000-0000-000000000002" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000002",
        labelId: label.id,
        name: "Rimi",
        bio: "Nghệ danh của Đỗ Đình Hoàng Anh. Spotify ID: 4Wu7KLXMzQFbYP8zoLNxsv, Apple Music ID: 1141759962",
      },
    });
    console.log(`Artist created: ${artist.name} (${artist.id})`);

    // 3. Create Permission: system.full_access
    console.log("Creating permission: system.full_access...");
    const permission = await prisma.permission.upsert({
      where: { code: "system.full_access" },
      update: {},
      create: {
        code: "system.full_access",
        name: "Full System Access",
        description: "Full access to all system features (Admin only)",
        category: "System",
      },
    });
    console.log(`Permission created: ${permission.code} (${permission.id})`);

    // 4. Create Role: Admin
    console.log("Creating role: Admin...");
    const role = await prisma.role.upsert({
      where: { name: "admin" },
      update: {},
      create: {
        name: "admin",
        displayName: "Admin",
        description: "Full system control, single account, validate/approve/deny music, ban accounts",
        isSystem: true,
      },
    });
    console.log(`Role created: ${role.displayName} (${role.id})`);

    // 5. Link Role to Permission
    console.log("Linking role to permission...");
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: role.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: role.id,
        permissionId: permission.id,
      },
    });
    console.log(`Role linked to permission`);

    // 6. Hash password
    console.log("Hashing password...");
    const hashedPassword = await bcrypt.hash("Manh0986613461@2RIMIPROD", 12);
    console.log(`Password hashed`);

    // 7. Create User
    console.log("Creating user: dodinhhoanganh@adedmusic.com...");
    const user = await prisma.user.upsert({
      where: { email: "dodinhhoanganh@adedmusic.com" },
      update: {
        password: hashedPassword,
        artistId: artist.id,
        labelId: label.id,
      },
      create: {
        email: "dodinhhoanganh@adedmusic.com",
        password: hashedPassword,
        isActive: true,
        isBanned: false,
        artistId: artist.id,
        labelId: label.id,
      },
    });
    console.log(`User created: ${user.email} (${user.id})`);

    // 8. Link User to Role
    console.log("Assigning Admin role to user...");
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId: role.id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        roleId: role.id,
      },
    });
    console.log(`User assigned Admin role`);

    console.log("\n" + "=".repeat(60));
    console.log("ADMIN USER CREATED SUCCESSFULLY!");
    console.log("=".repeat(60));
    console.log("\n Account Details:");
    console.log(`   Email:      dodinhhoanganh@adedmusic.com`);
    console.log(`   Password:   Manh0986613461@2RIMIPROD`);
    console.log(`   Real Name:  Đỗ Đình Hoàng Anh`);
    console.log(`   Stage Name: Rimi`);
    console.log(`   Role:       Admin (Full System Access)`);
    console.log(`   Artist:     Rimi (Spotify: 4Wu7KLXMzQFbYP8zoLNxsv, Apple: 1141759962)`);
    console.log(`   Label:      beAlpha`);
    console.log("\n You can now login at http://localhost:3000/login");

  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
