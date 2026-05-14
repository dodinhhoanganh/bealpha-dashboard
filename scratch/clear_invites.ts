import { prisma } from '../lib/prisma';

async function main() {
  const result = await prisma.invitation.deleteMany({});
  console.log(`Deleted ${result.count} invitations.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
