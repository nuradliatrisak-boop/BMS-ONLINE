import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const col = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'SuratJalan' AND column_name = 'batchId';
  `);
  console.log('Kolom batchId:', col.length > 0 ? 'ADA' : 'TIDAK ADA', col);

  const idx = await prisma.$queryRawUnsafe(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'SuratJalan' AND indexname = 'SuratJalan_batchId_idx';
  `);
  console.log('Index SuratJalan_batchId_idx:', idx.length > 0 ? 'ADA' : 'TIDAK ADA', idx);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});