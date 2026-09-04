-- Tambah kolom "batchId" ke SuratJalan supaya dokumen yang dibuat bareng
-- lewat "Jumlah Surat Jalan" > 1 (customer & tujuan sama, nomor beda-beda)
-- bisa ditandai satu grup. Dipakai supaya edit salah satu dokumen bisa
-- disamakan otomatis ke semua dokumen lain dalam grup yang sama.
ALTER TABLE "SuratJalan" ADD COLUMN "batchId" TEXT;

CREATE INDEX "SuratJalan_batchId_idx" ON "SuratJalan"("batchId");
