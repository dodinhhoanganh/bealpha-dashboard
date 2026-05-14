import "dotenv/config";
import { PrismaClient, EntityType, EntityRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function uuidToSlug(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8);
}

async function main() {
  console.log("🌱 Seeding B2B2B production database...\n");

  // ── 1. System Roles (required for staff-level permissions) ──
  const adminRole = await prisma.role.upsert({
    where: { name: "admin" },
    update: {},
    create: { name: "admin", displayName: "System Admin", isSystem: true },
  });

  await prisma.role.upsert({
    where: { name: "moderator" },
    update: {},
    create: { name: "moderator", displayName: "Moderator", isSystem: true },
  });

  await prisma.role.upsert({
    where: { name: "supporter" },
    update: {},
    create: { name: "supporter", displayName: "Supporter", isSystem: true },
  });

  await prisma.role.upsert({
    where: { name: "finance" },
    update: {},
    create: { name: "finance", displayName: "Finance", isSystem: true },
  });

  // Security audit S4: Never hardcode passwords in seed files.
  // Read from env var or generate a random one-time password.
  const seedPassword = process.env.SUPER_ADMIN_PASSWORD;
  if (!seedPassword) {
    const randomPass = require("crypto").randomBytes(16).toString("base64url") + "A1@";
    console.warn(`\n⚠️  No SUPER_ADMIN_PASSWORD env var set. Generated: ${randomPass}`);
    console.warn("   Save this password! It will not be shown again.\n");
    var hashedPassword = await bcrypt.hash(randomPass, 12);
  } else {
    var hashedPassword = await bcrypt.hash(seedPassword, 12);
  }

  const superAdminEntity = await prisma.businessEntity.create({
    data: {
      entityType: EntityType.SUPER_ADMIN,
      officialName: "beAlpha",
      path: "", // Will be set after creation
      description: "Root entity — platform super admin",
    },
  });

  const superAdminPath = uuidToSlug(superAdminEntity.id);
  await prisma.businessEntity.update({
    where: { id: superAdminEntity.id },
    data: { path: superAdminPath },
  });

  const superAdminUser = await prisma.user.create({
    data: {
      email: "dodinhhoanganh@adedmusic.com",
      password: hashedPassword,
      name: "Hoàng Anh",
      roles: { create: { roleId: adminRole.id } },
      entityRoles: {
        create: {
          entityId: superAdminEntity.id,
          role: EntityRole.OWNER,
        },
      },
    },
  });
  console.log(`✅ Super Admin: ${superAdminUser.email}`);

  console.log("\n🎉 Seed complete!\n");
  console.log("Hierarchy:");
  console.log(`  ${superAdminPath} — ADED Music (SUPER_ADMIN)`);
  console.log("\nAccounts:");
  console.log("  dodinhhoanganh@adedmusic.com — Super Admin (OWNER)");
  console.log("\nNext steps:");
  console.log("  1. Log in as Super Admin");
  console.log("  2. Create a SYSTEM_ADMIN entity for your operations team");
  console.log("  3. Create ORGANIZATION entities for your B2B clients");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
