import { prisma } from "../lib/prisma";

async function main() {
  const result = await prisma.businessEntity.updateMany({
    where: { officialName: "ADED Music" },
    data: { officialName: "beAlpha" },
  });
  console.log(`Updated ${result.count} entities`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
