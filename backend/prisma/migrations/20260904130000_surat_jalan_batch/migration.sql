-- Kelompok Surat Jalan yang dibuat bersamaan.
-- Data lama dibiarkan NULL agar tidak ada surat jalan lama yang salah tergabung.
ALTER TABLE "SuratJalan" ADD COLUMN "batchId" TEXT;
CREATE INDEX "SuratJalan_batchId_idx" ON "SuratJalan"("batchId");
